import { NextRequest, NextResponse } from "next/server";

const HASURA_URL =
  process.env.HASURA_URL || "http://localhost:8500/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.HASURA_ADMIN_SECRET || "";

type WorkflowStep = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  type: string;
  config: Record<string, unknown>;
};

async function hasura(
  query: string,
  variables: Record<string, unknown> = {}
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

  const result = await response.json();

  if (!response.ok || result.errors) {
    console.error("Hasura error:", result);
    throw new Error(
      result.errors?.[0]?.message || "Hasura request failed"
    );
  }

  return result.data;
}

export async function POST(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  try {
    const { id: workflowId } = await context.params;

    if (!workflowId) {
      return NextResponse.json(
        { error: "Workflow ID is required" },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 1. Get workflow
    // --------------------------------------------------

    const workflowData = await hasura(
      `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          name
          description
          created_by
        }
      }
      `,
      {
        id: workflowId,
      }
    );

    const workflow = workflowData.workflows_by_pk;

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 2. Get workflow steps
    // --------------------------------------------------

    const stepsData = await hasura(
      `
      query GetWorkflowSteps($workflow_id: uuid!) {
        workflow_steps(
          where: { workflow_id: { _eq: $workflow_id } }
          order_by: { step_order: asc }
        ) {
          id
          workflow_id
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

    const steps: WorkflowStep[] =
      stepsData.workflow_steps || [];

    // --------------------------------------------------
    // 3. Create workflow run
    // --------------------------------------------------

    const runData = await hasura(
      `
      mutation CreateWorkflowRun(
        $workflow_id: uuid!
        $triggered_by: uuid
      ) {
        insert_workflow_runs_one(
          object: {
            workflow_id: $workflow_id
            triggered_by: $triggered_by
            status: "running"
            started_at: "now()"
          }
        ) {
          id
          workflow_id
          status
          started_at
        }
      }
      `,
      {
        workflow_id: workflowId,
        triggered_by: workflow.created_by,
      }
    );

    const workflowRun =
      runData.insert_workflow_runs_one;

    if (!workflowRun) {
      throw new Error("Failed to create workflow run");
    }

    // --------------------------------------------------
    // 4. Execute each workflow step
    // --------------------------------------------------

    const stepResults: Array<{
      step_id: string;
      step_order: number;
      name: string;
      type: string;
      status: string;
      output: Record<string, unknown>;
    }> = [];

    let workflowContext: Record<string, unknown> = {};

    for (const step of steps) {
      let stepRunId: string | null = null;

      try {
        // ----------------------------------------------
        // Create step run
        // ----------------------------------------------

        const stepRunData = await hasura(
          `
          mutation CreateStepRun(
            $workflow_run_id: uuid!
            $workflow_step_id: uuid!
            $input: jsonb
          ) {
            insert_step_runs_one(
              object: {
                workflow_run_id: $workflow_run_id
                workflow_step_id: $workflow_step_id
                status: "running"
                input: $input
                started_at: "now()"
              }
            ) {
              id
            }
          }
          `,
          {
            workflow_run_id: workflowRun.id,
            workflow_step_id: step.id,
            input: workflowContext,
          }
        );

        stepRunId =
          stepRunData.insert_step_runs_one?.id || null;

        // ----------------------------------------------
        // Execute according to step type
        // ----------------------------------------------

        let output: Record<string, unknown> = {};

        switch (step.type) {
          case "llm_call": {
            const prompt =
              typeof step.config?.prompt === "string"
                ? step.config.prompt
                : "Process the input.";

            /*
             * For the assignment, this provides a deterministic
             * workflow execution without requiring an external
             * OpenAI API key.
             *
             * The actual prompt/config is preserved in the
             * execution result so the step can later be connected
             * to a real LLM provider.
             */

            output = {
              provider: "workflow-engine",
              prompt,
              result:
                "general",
              message:
                "LLM step executed successfully.",
            };

            workflowContext = {
              ...workflowContext,
              classification: "general",
              llm_result: output.result,
            };

            break;
          }

          case "conditional_branch": {
            const condition =
              typeof step.config?.condition === "string"
                ? step.config.condition
                : "true";

            const branches = Array.isArray(
              step.config?.branches
            )
              ? step.config.branches
              : [];

            const classification =
              workflowContext.classification || "general";

            const branchSelected =
              branches.length === 0 ||
              branches.includes(classification);

            output = {
              condition,
              classification,
              branches,
              selected_branch: branchSelected
                ? classification
                : "general",
              condition_met: branchSelected,
            };

            workflowContext = {
              ...workflowContext,
              selected_branch: branchSelected
                ? classification
                : "general",
            };

            break;
          }

          case "db_write": {
            const dataInsert = await hasura(
              `
              mutation SaveWorkflowData(
                $org_id: uuid!
                $workflow_run_id: uuid!
                $data: jsonb!
              ) {
                insert_workflow_data_one(
                  object: {
                    org_id: $org_id
                    workflow_run_id: $workflow_run_id
                    data: $data
                  }
                ) {
                  id
                  created_at
                }
              }
              `,
              {
                org_id: workflow.org_id,
                workflow_run_id: workflowRun.id,
                data: workflowContext,
              }
            );

            output = {
              operation: "insert",
              table: "workflow_data",
              saved: true,
              record_id:
                dataInsert.insert_workflow_data_one?.id ||
                null,
            };

            break;
          }

          case "notify": {
            const channel =
              typeof step.config?.channel === "string"
                ? step.config.channel
                : "email";

            const notificationMessage =
              typeof step.config?.message === "string"
                ? step.config.message
                : "Workflow completed successfully.";

            output = {
              channel,
              message: notificationMessage,
              sent: true,
              simulated: true,
            };

            break;
          }

          case "http_request": {
            const url =
              typeof step.config?.url === "string"
                ? step.config.url
                : "";

            output = {
              url,
              method:
                typeof step.config?.method === "string"
                  ? step.config.method
                  : "GET",
              executed: false,
              message:
                "HTTP step is configured but external request execution is disabled in this assignment environment.",
            };

            break;
          }

          case "approval_gate": {
            output = {
              approved: true,
              simulated: true,
              message:
                "Approval gate automatically approved for workflow execution.",
            };

            break;
          }

          default: {
            throw new Error(
              `Unsupported workflow step type: ${step.type}`
            );
          }
        }

        // ----------------------------------------------
        // Mark step completed
        // ----------------------------------------------

        if (stepRunId) {
          await hasura(
            `
            mutation CompleteStepRun(
              $id: uuid!
              $output: jsonb!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "completed"
                  output: $output
                  completed_at: "now()"
                }
              ) {
                id
                status
                completed_at
              }
            }
            `,
            {
              id: stepRunId,
              output,
            }
          );
        }

        stepResults.push({
          step_id: step.id,
          step_order: step.step_order,
          name: step.name,
          type: step.type,
          status: "completed",
          output,
        });
      } catch (stepError) {
        const errorMessage =
          stepError instanceof Error
            ? stepError.message
            : "Step execution failed";

        // ----------------------------------------------
        // Mark step failed
        // ----------------------------------------------

        if (stepRunId) {
          await hasura(
            `
            mutation FailStepRun(
              $id: uuid!
              $error: String!
            ) {
              update_step_runs_by_pk(
                pk_columns: { id: $id }
                _set: {
                  status: "failed"
                  error: $error
                  completed_at: "now()"
                }
              ) {
                id
                status
              }
            }
            `,
            {
              id: stepRunId,
              error: errorMessage,
            }
          );
        }

        // ----------------------------------------------
        // Mark workflow failed
        // ----------------------------------------------

        await hasura(
          `
          mutation FailWorkflowRun(
            $id: uuid!
            $error: String!
          ) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id }
              _set: {
                status: "failed"
                error: $error
                completed_at: "now()"
              }
            ) {
              id
              status
              error
            }
          }
          `,
          {
            id: workflowRun.id,
            error: errorMessage,
          }
        );

        return NextResponse.json(
          {
            success: false,
            workflow_run_id: workflowRun.id,
            status: "failed",
            error: errorMessage,
            steps: stepResults,
          },
          { status: 500 }
        );
      }
    }

    // --------------------------------------------------
    // 5. Mark workflow completed
    // --------------------------------------------------

    const completedData = await hasura(
      `
      mutation CompleteWorkflowRun($id: uuid!) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: "completed"
            completed_at: "now()"
          }
        ) {
          id
          status
          started_at
          completed_at
        }
      }
      `,
      {
        id: workflowRun.id,
      }
    );

    const completedRun =
      completedData.update_workflow_runs_by_pk;

    // --------------------------------------------------
    // 6. Return execution result
    // --------------------------------------------------

    return NextResponse.json({
      success: true,
      message: "Workflow executed successfully.",
      workflow: {
        id: workflow.id,
        name: workflow.name,
      },
      workflow_run: completedRun,
      steps: stepResults,
    });
  } catch (error) {
    console.error("Workflow execution error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to execute workflow.",
      },
      { status: 500 }
    );
  }
}