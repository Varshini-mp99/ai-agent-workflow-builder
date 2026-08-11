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
      result.errors?.[0]?.message ||
        "Hasura request failed"
    );
  }

  return result.data;
}

/* ======================================================
   HTTP REQUEST WITH ONE RETRY
====================================================== */

async function executeHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  retries = 1
): Promise<Record<string, unknown>> {
  let lastError = "HTTP request failed";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body:
          body !== undefined && method !== "GET"
            ? typeof body === "string"
              ? body
              : JSON.stringify(body)
            : undefined,
      });

      const contentType =
        response.headers.get("content-type") || "";

      let responseBody: unknown;

      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;

        if (attempt < retries) {
          await new Promise((resolve) =>
            setTimeout(resolve, 500)
          );

          continue;
        }

        throw new Error(lastError);
      }

      return {
        success: true,
        status: response.status,
        status_text: response.statusText,
        url,
        method,
        response: responseBody,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error.message
          : "HTTP request failed";

      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500)
        );

        continue;
      }

      throw new Error(
        `${lastError} after ${attempt + 1} attempt(s)`
      );
    }
  }

  throw new Error(lastError);
}

/* ======================================================
   POST /api/workflows/[id]/run
====================================================== */

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
        {
          error: "Workflow ID is required",
        },
        {
          status: 400,
        }
      );
    }

    /* ==================================================
       1. GET WORKFLOW
    ================================================== */

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

    const workflow =
      workflowData.workflows_by_pk;

    if (!workflow) {
      return NextResponse.json(
        {
          error: "Workflow not found",
        },
        {
          status: 404,
        }
      );
    }

    /* ==================================================
       2. GET WORKFLOW STEPS
    ================================================== */

    const stepsData = await hasura(
      `
      query GetWorkflowSteps(
        $workflow_id: uuid!
      ) {
        workflow_steps(
          where: {
            workflow_id: {
              _eq: $workflow_id
            }
          }
          order_by: {
            step_order: asc
          }
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

    /* ==================================================
       3. CREATE WORKFLOW RUN
    ================================================== */

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
      throw new Error(
        "Failed to create workflow run"
      );
    }

    /* ==================================================
       4. EXECUTE STEPS
    ================================================== */

    const stepResults: Array<{
      step_id: string;
      step_order: number;
      name: string;
      type: string;
      status: string;
      output: Record<string, unknown>;
    }> = [];

    let workflowContext: Record<
      string,
      unknown
    > = {};

    for (const step of steps) {
      let stepRunId: string | null = null;

      try {
        /* ==============================================
           CREATE STEP RUN
        ============================================== */

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
          stepRunData.insert_step_runs_one?.id ||
          null;

        /* ==============================================
           STEP EXECUTION
        ============================================== */

        let output: Record<
          string,
          unknown
        > = {};

        switch (step.type) {
          /* ============================================
             LLM CALL
          ============================================ */

          case "llm_call": {
            const prompt =
              typeof step.config?.prompt ===
              "string"
                ? step.config.prompt
                : "Process the input.";

            await new Promise((resolve) =>
              setTimeout(resolve, 1200)
            );

            output = {
              provider:
                "workflow-engine-stub",
              simulated: true,
              artificial_delay_ms: 1200,
              prompt,
              result: "general",
              message:
                "Stubbed LLM step executed successfully.",
            };

            workflowContext = {
              ...workflowContext,
              classification: "general",
              llm_result: output.result,
            };

            break;
          }

          /* ============================================
             CONDITIONAL BRANCH
          ============================================ */

          case "conditional_branch": {
            const condition =
              typeof step.config?.condition ===
              "string"
                ? step.config.condition
                : "true";

            const branches = Array.isArray(
              step.config?.branches
            )
              ? step.config.branches
              : [];

            const classification =
              workflowContext.classification ||
              "general";

            const branchSelected =
              branches.length === 0 ||
              branches.includes(classification);

            output = {
              condition,
              classification,
              branches,
              selected_branch:
                branchSelected
                  ? classification
                  : "general",
              condition_met:
                branchSelected,
            };

            workflowContext = {
              ...workflowContext,
              selected_branch:
                branchSelected
                  ? classification
                  : "general",
            };

            break;
          }

          /* ============================================
             HTTP REQUEST
          ============================================ */

          case "http_request": {
            const url =
              typeof step.config?.url ===
              "string"
                ? step.config.url
                : "";

            if (!url) {
              throw new Error(
                "HTTP request step requires a URL"
              );
            }

            const method =
              typeof step.config?.method ===
              "string"
                ? step.config.method.toUpperCase()
                : "GET";

            const configuredHeaders =
              step.config?.headers;

            const headers: Record<
              string,
              string
            > = {
              "Content-Type":
                "application/json",
            };

            if (
              configuredHeaders &&
              typeof configuredHeaders ===
                "object" &&
              !Array.isArray(
                configuredHeaders
              )
            ) {
              for (const [
                key,
                value,
              ] of Object.entries(
                configuredHeaders
              )) {
                headers[key] = String(value);
              }
            }

            const body =
              step.config?.body !== undefined
                ? step.config.body
                : undefined;

            output =
              await executeHttpRequest(
                url,
                method,
                headers,
                body,
                1
              );

            workflowContext = {
              ...workflowContext,
              http_result: output,
            };

            break;
          }

          /* ============================================
             APPROVAL GATE
          ============================================ */

          case "approval_gate": {
            output = {
              approved: false,
              paused: true,
              message:
                typeof step.config?.message ===
                "string"
                  ? step.config.message
                  : "Waiting for approval.",
            };

            /* ------------------------------------------
               PAUSE STEP
            ------------------------------------------ */

            if (stepRunId) {
              await hasura(
                `
                mutation PauseStepRun(
                  $id: uuid!
                  $output: jsonb!
                ) {
                  update_step_runs_by_pk(
                    pk_columns: {
                      id: $id
                    }
                    _set: {
                      status: "paused"
                      output: $output
                    }
                  ) {
                    id
                    status
                    output
                  }
                }
                `,
                {
                  id: stepRunId,
                  output,
                }
              );
            }

            /* ------------------------------------------
               PAUSE WORKFLOW
            ------------------------------------------ */

            await hasura(
              `
              mutation PauseWorkflowRun(
                $id: uuid!
              ) {
                update_workflow_runs_by_pk(
                  pk_columns: {
                    id: $id
                  }
                  _set: {
                    status: "paused"
                  }
                ) {
                  id
                  status
                }
              }
              `,
              {
                id: workflowRun.id,
              }
            );

            /* ------------------------------------------
               STOP EXECUTION
            ------------------------------------------ */

            return NextResponse.json({
              success: true,
              message:
                "Workflow paused awaiting approval.",
              workflow_run: {
                id: workflowRun.id,
                status: "paused",
              },
              paused_step: {
                id: step.id,
                name: step.name,
                type: step.type,
              },
              steps: stepResults,
            });
          }

          /* ============================================
             DATABASE WRITE
          ============================================ */

          case "db_write": {
            const dataInsert =
              await hasura(
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
                  workflow_run_id:
                    workflowRun.id,
                  data: workflowContext,
                }
              );

            output = {
              operation: "insert",
              table: "workflow_data",
              saved: true,
              record_id:
                dataInsert
                  .insert_workflow_data_one
                  ?.id || null,
            };

            break;
          }

          /* ============================================
             NOTIFY
          ============================================ */

          case "notify": {
            const channel =
              typeof step.config?.channel ===
              "string"
                ? step.config.channel
                : "email";

            const notificationMessage =
              typeof step.config?.message ===
              "string"
                ? step.config.message
                : "Workflow completed successfully.";

            output = {
              channel,
              message:
                notificationMessage,
              sent: true,
              simulated: true,
            };

            break;
          }

          /* ============================================
             UNSUPPORTED TYPE
          ============================================ */

          default: {
            throw new Error(
              `Unsupported workflow step type: ${step.type}`
            );
          }
        }

        /* ==============================================
           MARK STEP COMPLETED
        ============================================== */

        if (stepRunId) {
          await hasura(
            `
            mutation CompleteStepRun(
              $id: uuid!
              $output: jsonb!
            ) {
              update_step_runs_by_pk(
                pk_columns: {
                  id: $id
                }
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

        /* ==============================================
           MARK STEP FAILED
        ============================================== */

        if (stepRunId) {
          await hasura(
            `
            mutation FailStepRun(
              $id: uuid!
              $error: String!
            ) {
              update_step_runs_by_pk(
                pk_columns: {
                  id: $id
                }
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

        /* ==============================================
           MARK WORKFLOW FAILED
        ============================================== */

        await hasura(
          `
          mutation FailWorkflowRun(
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
            workflow_run_id:
              workflowRun.id,
            status: "failed",
            error: errorMessage,
            steps: stepResults,
          },
          {
            status: 500,
          }
        );
      }
    }

    /* ==================================================
       5. MARK WORKFLOW COMPLETED
    ================================================== */

    const completedData = await hasura(
      `
      mutation CompleteWorkflowRun(
        $id: uuid!
      ) {
        update_workflow_runs_by_pk(
          pk_columns: {
            id: $id
          }
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
      completedData
        .update_workflow_runs_by_pk;

    /* ==================================================
       6. RETURN EXECUTION RESULT
    ================================================== */

    return NextResponse.json({
      success: true,
      message:
        "Workflow executed successfully.",
      workflow: {
        id: workflow.id,
        name: workflow.name,
      },
      workflow_run: completedRun,
      steps: stepResults,
    });
  } catch (error) {
    console.error(
      "Workflow execution error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to execute workflow.",
      },
      {
        status: 500,
      }
    );
  }
}