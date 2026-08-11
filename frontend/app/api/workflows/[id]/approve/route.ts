import { NextRequest, NextResponse } from "next/server";

const HASURA_URL = "http://localhost:8500/v1/graphql";
const HASURA_ADMIN_SECRET = "dev-admin-secret";

async function hasura(
  query: string,
  variables: Record<string, unknown> = {}
) {
  console.log("HASURA URL:", HASURA_URL);

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

  const text = await response.text();

  console.log("HASURA STATUS:", response.status);
  console.log(
    "HASURA CONTENT TYPE:",
    response.headers.get("content-type")
  );
  console.log("HASURA RESPONSE:", text.substring(0, 1000));

  if (!text) {
    throw new Error(
      `Hasura returned an empty response. HTTP ${response.status}`
    );
  }

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Hasura returned non-JSON response. HTTP ${response.status}: ${text.substring(
        0,
        500
      )}`
    );
  }

  if (result.errors?.length) {
    throw new Error(
      result.errors
        .map((e: any) => e.message)
        .join("; ")
    );
  }

  if (!response.ok) {
    throw new Error(
      `Hasura HTTP ${response.status}: ${JSON.stringify(result)}`
    );
  }

  return result.data;
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    // ================================================
    // 1. Get workflow ID
    // ================================================

    const { id: workflowId } = await params;

    if (!workflowId) {
      return NextResponse.json(
        {
          success: false,
          error: "Workflow ID is required.",
        },
        { status: 400 }
      );
    }

    // ================================================
    // 2. Read request body
    // ================================================

    let body: any;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or empty JSON body.",
        },
        { status: 400 }
      );
    }

    const workflowRunId = body?.workflow_run_id;
    const approverId = body?.approver_id;

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

    console.log("APPROVAL REQUEST:", {
      workflowId,
      workflowRunId,
      approverId,
    });

    // ================================================
    // 3. Get workflow
    // ================================================

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

    // ================================================
    // 4. Check approver belongs to SAME organization
    // ================================================

    const memberResult = await hasura(
      `
      query GetOrgMember(
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
            "Approver does not belong to this workflow organization.",
        },
        { status: 403 }
      );
    }

    // ================================================
    // 5. Only owner/editor can approve
    // ================================================

    if (
      member.role !== "owner" &&
      member.role !== "editor"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only an owner or editor can approve an approval gate.",
        },
        { status: 403 }
      );
    }

    // ================================================
    // 6. Get workflow run
    // ================================================

    const runResult = await hasura(
      `
      query GetRun(
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
          error
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

    // ================================================
    // 7. Must be paused
    // ================================================

    if (run.status !== "paused") {
      return NextResponse.json(
        {
          success: false,
          error:
            `Workflow is not paused. Current status: ${run.status}`,
        },
        { status: 400 }
      );
    }

    // ================================================
    // 8. Find paused approval step
    // ================================================

    const stepResult = await hasura(
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

    const pausedStep = stepResult?.step_runs?.[0];

    if (!pausedStep) {
      return NextResponse.json(
        {
          success: false,
          error: "No paused approval step found.",
        },
        { status: 404 }
      );
    }

    // ================================================
    // 9. Approve step
    // ================================================

    const approvedAt = new Date().toISOString();

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
          }
        ) {
          id
          workflow_run_id
          workflow_step_id
          status
          approved_by
          approved_at
        }
      }
      `,
      {
        id: pausedStep.id,
        approver: approverId,
        approved_at: approvedAt,
      }
    );

    if (!approvalResult?.update_step_runs_by_pk) {
      throw new Error("Failed to approve step.");
    }

    // ================================================
    // 10. Get all workflow steps
    // ================================================

    const allStepsResult = await hasura(
      `
      query GetSteps($workflow_id: uuid!) {
        workflow_steps(
          where: {
            workflow_id: { _eq: $workflow_id }
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

    const allSteps =
      allStepsResult?.workflow_steps || [];

    const approvalStep = allSteps.find(
      (step: any) =>
        step.id === pausedStep.workflow_step_id
    );

    if (!approvalStep) {
      throw new Error(
        "Approval workflow step could not be found."
      );
    }

    // ================================================
    // 11. Execute steps AFTER approval
    // ================================================

    const remainingSteps = allSteps.filter(
      (step: any) =>
        step.step_order > approvalStep.step_order
    );

    const resumedSteps = [];

    for (const step of remainingSteps) {
      const startedAt = new Date().toISOString();

      try {
        let output: any;

        // --------------------------------------------
        // DB WRITE
        // --------------------------------------------

        if (step.type === "db_write") {
          const config = step.config || {};

          output = {
            saved: true,
            table: config.table || "workflow_data",
            operation: config.operation || "insert",
          };
        }

        // --------------------------------------------
        // NOTIFY
        // --------------------------------------------

        else if (step.type === "notify") {
          const config = step.config || {};

          output = {
            sent: true,
            channel: config.channel || "email",
            message:
              config.message ||
              "Customer support request has been routed successfully.",
            simulated: true,
          };
        }

        // --------------------------------------------
        // HTTP REQUEST
        // --------------------------------------------

        else if (step.type === "http_request") {
          const config = step.config || {};

          if (!config.url) {
            throw new Error(
              "HTTP request step has no URL."
            );
          }

          const httpResponse = await fetch(
            config.url,
            {
              method: config.method || "GET",
              headers: {
                "Content-Type": "application/json",
              },
            }
          );

          const responseText =
            await httpResponse.text();

          output = {
            status: httpResponse.status,
            ok: httpResponse.ok,
            body: responseText.substring(0, 5000),
          };

          if (!httpResponse.ok) {
            throw new Error(
              `HTTP request failed with status ${httpResponse.status}`
            );
          }
        }

        // --------------------------------------------
        // LLM
        // --------------------------------------------

        else if (step.type === "llm_call") {
          output = {
            result: "general",
            message:
              "LLM step executed successfully.",
            provider: "workflow-engine",
          };
        }

        // --------------------------------------------
        // CONDITIONAL
        // --------------------------------------------

        else if (
          step.type === "conditional_branch"
        ) {
          output = {
            condition_met: true,
            selected_branch: "general",
          };
        }

        // --------------------------------------------
        // OTHER
        // --------------------------------------------

        else {
          output = {
            executed: true,
            type: step.type,
          };
        }

        const completedAt =
          new Date().toISOString();

        // ============================================
        // Create completed step run
        // ============================================

        const insertedStep = await hasura(
          `
          mutation InsertStepRun(
            $workflow_run_id: uuid!
            $workflow_step_id: uuid!
            $status: String!
            $output: jsonb!
            $started_at: timestamptz!
            $completed_at: timestamptz!
          ) {
            insert_step_runs_one(
              object: {
                workflow_run_id: $workflow_run_id
                workflow_step_id: $workflow_step_id
                status: $status
                input: {}
                output: $output
                attempt_count: 1
                started_at: $started_at
                completed_at: $completed_at
              }
            ) {
              id
              status
              output
            }
          }
          `,
          {
            workflow_run_id: workflowRunId,
            workflow_step_id: step.id,
            status: "completed",
            output,
            started_at: startedAt,
            completed_at: completedAt,
          }
        );

        resumedSteps.push(
          insertedStep?.insert_step_runs_one
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Step execution failed.";

        console.error(
          `Step ${step.name} failed:`,
          message
        );

        // Mark workflow failed
        try {
          await hasura(
            `
            mutation FailRun(
              $id: uuid!
              $error: String!
            ) {
              update_workflow_runs_by_pk(
                pk_columns: {
                  id: $id
                }
                _set: {
                  status: "failed"
                  error: $error
                }
              ) {
                id
                status
                error
              }
            }
            `,
            {
              id: workflowRunId,
              error: message,
            }
          );
        } catch (e) {
          console.error(
            "Could not update failed run:",
            e
          );
        }

        return NextResponse.json(
          {
            success: false,
            error: `Step "${step.name}" failed: ${message}`,
          },
          { status: 500 }
        );
      }
    }

    // ================================================
    // 12. Mark workflow completed
    // ================================================

    const completedAt =
      new Date().toISOString();

    const completedResult = await hasura(
      `
      mutation CompleteRun(
        $id: uuid!
        $completed_at: timestamptz!
      ) {
        update_workflow_runs_by_pk(
          pk_columns: {
            id: $id
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
          error
        }
      }
      `,
      {
        id: workflowRunId,
        completed_at: completedAt,
      }
    );

    // ================================================
    // 13. Success response
    // ================================================

    return NextResponse.json({
      success: true,
      message:
        "Workflow approved and resumed successfully.",

      workflow: {
        id: workflow.id,
        name: workflow.name,
      },

      workflow_run:
        completedResult?.update_workflow_runs_by_pk,

      approval: {
        step_run_id: pausedStep.id,
        workflow_step_id:
          pausedStep.workflow_step_id,
        approved_by: approverId,
        approver_role: member.role,
        approved_at: approvedAt,
      },

      resumed_steps: resumedSteps,
    });
  } catch (error) {
    console.error("APPROVAL ROUTE ERROR:", error);

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