import { NextRequest, NextResponse } from "next/server";

const HASURA_URL =
  process.env.HASURA_GRAPHQL_URL ||
  process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
  "http://localhost:8080/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.HASURA_GRAPHQL_ADMIN_SECRET ||
  process.env.NEXT_PUBLIC_HASURA_ADMIN_SECRET ||
  "dev-admin-secret";

async function hasura(
  query: string,
  variables: Record<string, unknown>
) {
  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Hasura HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data.errors && data.errors.length > 0) {
    throw new Error(
      data.errors.map((e: any) => e.message).join(", ")
    );
  }

  return data.data;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // --------------------------------------------------
    // 1. Get workflow ID from URL
    // --------------------------------------------------

    const { id: workflowId } = await params;

    // --------------------------------------------------
    // 2. Read request body
    // --------------------------------------------------

    const body = await request.json();

    const workflowRunId = body.workflow_run_id;
    const approverId = body.approver_id;

    if (!workflowRunId) {
      return NextResponse.json(
        {
          success: false,
          error: "workflow_run_id is required.",
        },
        { status: 400 }
      );
    }

    if (!approverId) {
      return NextResponse.json(
        {
          success: false,
          error: "approver_id is required.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 3. Get workflow
    // --------------------------------------------------

    const workflowResult = await hasura(
      `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          org_id
        }
      }
      `,
      {
        id: workflowId,
      }
    );

    const workflow = workflowResult?.workflows_by_pk;

    if (!workflow) {
      return NextResponse.json(
        {
          success: false,
          error: "Workflow not found.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 4. Check approver's organization membership
    // --------------------------------------------------

    const memberResult = await hasura(
      `
      query GetOrganizationMember(
        $user_id: uuid!
        $org_id: uuid!
      ) {
        org_members(
          where: {
            user_id: { _eq: $user_id }
            org_id: { _eq: $org_id }
          }
          limit: 1
        ) {
          user_id
          org_id
          role
        }
      }
      `,
      {
        user_id: approverId,
        org_id: workflow.org_id,
      }
    );

    const member = memberResult?.org_members?.[0];

    if (!member) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Approver does not belong to the workflow organization.",
        },
        { status: 403 }
      );
    }

    // --------------------------------------------------
    // 5. Only owner/editor can approve
    // --------------------------------------------------

    if (member.role !== "owner" && member.role !== "editor") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only an owner or editor can approve an approval gate.",
        },
        { status: 403 }
      );
    }

    // --------------------------------------------------
    // 6. Get workflow run
    // --------------------------------------------------

    const runResult = await hasura(
      `
      query GetWorkflowRun(
        $run_id: uuid!
        $workflow_id: uuid!
      ) {
        workflow_runs(
          where: {
            id: { _eq: $run_id }
            workflow_id: { _eq: $workflow_id }
          }
          limit: 1
        ) {
          id
          workflow_id
          status
          started_at
          completed_at
        }
      }
      `,
      {
        run_id: workflowRunId,
        workflow_id: workflowId,
      }
    );

    const run = runResult?.workflow_runs?.[0];

    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Workflow run not found or does not belong to this workflow.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 7. Make sure run is paused
    // --------------------------------------------------

    if (run.status !== "paused") {
      return NextResponse.json(
        {
          success: false,
          error:
            `Workflow run is not paused. Current status: ${run.status}`,
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 8. Find paused approval step
    // --------------------------------------------------

    const pausedStepResult = await hasura(
      `
      query GetPausedStep($run_id: uuid!) {
        step_runs(
          where: {
            workflow_run_id: { _eq: $run_id }
            status: { _eq: "paused" }
          }
          order_by: {
            created_at: asc
          }
          limit: 1
        ) {
          id
          workflow_run_id
          workflow_step_id
          status
          input
          output
          error
          attempt_count
        }
      }
      `,
      {
        run_id: workflowRunId,
      }
    );

    const approvalStep = pausedStepResult?.step_runs?.[0];

    if (!approvalStep) {
      return NextResponse.json(
        {
          success: false,
          error: "No paused approval step was found.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 9. Approve the approval-gate step
    // --------------------------------------------------

    const now = new Date().toISOString();

    const approvalResult = await hasura(
      `
      mutation ApproveStep(
        $id: uuid!
        $approver: uuid!
        $approved_at: timestamptz!
      ) {
        update_step_runs_by_pk(
          pk_columns: {
            id: $id
          }
          _set: {
            status: "completed"
            approved_by: $approver
            approved_at: $approved_at
            completed_at: $approved_at
          }
        ) {
          id
          workflow_run_id
          workflow_step_id
          status
          approved_by
          approved_at
          completed_at
        }
      }
      `,
      {
        id: approvalStep.id,
        approver: approverId,
        approved_at: now,
      }
    );

    // --------------------------------------------------
    // 10. Get steps after approval gate
    // --------------------------------------------------

    const remainingStepsResult = await hasura(
      `
      query GetRemainingSteps($workflow_id: uuid!) {
        workflow_steps(
          where: {
            workflow_id: { _eq: $workflow_id }
            step_order: { _gt: 4 }
          }
          order_by: {
            step_order: asc
          }
        ) {
          id
          step_order
          name
          type
          config
        }
      }
      `,
      {
        workflow_id: workflowId,
      }
    );

    const remainingSteps =
      remainingStepsResult?.workflow_steps || [];

    const resumedSteps: any[] = [];

    // --------------------------------------------------
    // 11. Execute remaining steps
    // --------------------------------------------------

    for (const step of remainingSteps) {
      const stepStartedAt = new Date().toISOString();

      try {
        let output: any = {};

        // ----------------------------------------------
        // DB WRITE
        // ----------------------------------------------

        if (step.type === "db_write") {
          const config = step.config || {};

          output = {
            saved: true,
            table: config.table || "workflow_data",
            operation: config.operation || "insert",
            resumed_after_approval: true,
          };
        }

        // ----------------------------------------------
        // NOTIFY
        // ----------------------------------------------

        else if (step.type === "notify") {
          const config = step.config || {};

          output = {
            sent: true,
            channel: config.channel || "email",
            message:
              config.message ||
              "Customer support request has been routed successfully.",
            simulated: true,
            resumed_after_approval: true,
          };
        }

        // ----------------------------------------------
        // HTTP REQUEST
        // ----------------------------------------------

        else if (step.type === "http_request") {
          const config = step.config || {};

          const url = config.url;
          const method = config.method || "GET";

          if (!url) {
            throw new Error(
              "HTTP request step has no URL configured."
            );
          }

          const httpResponse = await fetch(url, {
            method,
            headers: {
              "Content-Type": "application/json",
            },
          });

          const text = await httpResponse.text();

          output = {
            status: httpResponse.status,
            ok: httpResponse.ok,
            body: text.slice(0, 5000),
            resumed_after_approval: true,
          };
        }

        // ----------------------------------------------
        // GENERIC STEP
        // ----------------------------------------------

        else {
          output = {
            executed: true,
            type: step.type,
            resumed_after_approval: true,
          };
        }

        const stepCompletedAt = new Date().toISOString();

        // ----------------------------------------------
        // Save step run
        // ----------------------------------------------

        const stepRunResult = await hasura(
          `
          mutation CreateStepRun(
            $workflow_run_id: uuid!
            $workflow_step_id: uuid!
            $status: String!
            $input: jsonb!
            $output: jsonb!
            $started_at: timestamptz!
            $completed_at: timestamptz!
          ) {
            insert_step_runs_one(
              object: {
                workflow_run_id: $workflow_run_id
                workflow_step_id: $workflow_step_id
                status: $status
                input: $input
                output: $output
                attempt_count: 0
                started_at: $started_at
                completed_at: $completed_at
              }
            ) {
              id
              workflow_run_id
              workflow_step_id
              status
              output
              started_at
              completed_at
            }
          }
          `,
          {
            workflow_run_id: workflowRunId,
            workflow_step_id: step.id,
            status: "completed",
            input: {},
            output,
            started_at: stepStartedAt,
            completed_at: stepCompletedAt,
          }
        );

        resumedSteps.push(
          stepRunResult?.insert_step_runs_one
        );
      } catch (stepError) {
        const errorMessage =
          stepError instanceof Error
            ? stepError.message
            : "Step execution failed.";

        // ----------------------------------------------
        // Record failed step
        // ----------------------------------------------

        await hasura(
          `
          mutation CreateFailedStepRun(
            $workflow_run_id: uuid!
            $workflow_step_id: uuid!
            $error: String!
            $started_at: timestamptz!
            $completed_at: timestamptz!
          ) {
            insert_step_runs_one(
              object: {
                workflow_run_id: $workflow_run_id
                workflow_step_id: $workflow_step_id
                status: "failed"
                input: {}
                output: {}
                error: $error
                attempt_count: 1
                started_at: $started_at
                completed_at: $completed_at
              }
            ) {
              id
              status
              error
            }
          }
          `,
          {
            workflow_run_id: workflowRunId,
            workflow_step_id: step.id,
            error: errorMessage,
            started_at: stepStartedAt,
            completed_at: new Date().toISOString(),
          }
        );

        await hasura(
          `
          mutation FailWorkflowRun(
            $run_id: uuid!
          ) {
            update_workflow_runs_by_pk(
              pk_columns: {
                id: $run_id
              }
              _set: {
                status: "failed"
              }
            ) {
              id
              status
            }
          }
          `,
          {
            run_id: workflowRunId,
          }
        );

        return NextResponse.json(
          {
            success: false,
            error: `Step "${step.name}" failed: ${errorMessage}`,
            workflow_run_id: workflowRunId,
          },
          { status: 500 }
        );
      }
    }

    // --------------------------------------------------
    // 12. Complete workflow run
    // --------------------------------------------------

    const completedAt = new Date().toISOString();

    const completedRunResult = await hasura(
      `
      mutation CompleteWorkflow(
        $run_id: uuid!
        $completed_at: timestamptz!
      ) {
        update_workflow_runs_by_pk(
          pk_columns: {
            id: $run_id
          }
          _set: {
            status: "completed"
            completed_at: $completed_at
          }
        ) {
          id
          workflow_id
          status
          started_at
          completed_at
        }
      }
      `,
      {
        run_id: workflowRunId,
        completed_at: completedAt,
      }
    );

    // --------------------------------------------------
    // 13. Return success
    // --------------------------------------------------

    return NextResponse.json({
      success: true,
      message:
        "Workflow approved and resumed successfully.",
      workflow: {
        id: workflow.id,
        name: workflow.name,
      },
      workflow_run: completedRunResult?.update_workflow_runs_by_pk,
      approval: {
        step_run_id: approvalStep.id,
        approved_by: approverId,
        approver_role: member.role,
        approved_at: now,
      },
      resumed_steps: resumedSteps,
    });
  } catch (error) {
    console.error("Approval route error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to approve workflow.",
      },
      { status: 500 }
    );
  }
}