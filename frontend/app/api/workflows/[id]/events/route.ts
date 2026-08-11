import { NextRequest } from "next/server";

const HASURA_URL =
  process.env.HASURA_URL || "http://localhost:8500/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.HASURA_ADMIN_SECRET || "dev-admin-secret";

async function getRunStatus(workflowRunId: string) {
  const query = `
    query GetWorkflowRun($id: uuid!) {
      workflow_runs_by_pk(id: $id) {
        id
        workflow_id
        status
        started_at
        completed_at
        error
      }
    }
  `;

  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({
      query,
      variables: {
        id: workflowRunId,
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Hasura returned HTTP ${response.status}: ${text}`
    );
  }

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Hasura returned invalid JSON: ${text.substring(0, 500)}`
    );
  }

  if (result.errors?.length) {
    throw new Error(
      result.errors
        .map((error: any) => error.message)
        .join("; ")
    );
  }

  return result.data?.workflow_runs_by_pk;
}

async function getStepRuns(workflowRunId: string) {
  const query = `
    query GetStepRuns($run_id: uuid!) {
      step_runs(
        where: {
          workflow_run_id: { _eq: $run_id }
        }
        order_by: {
          created_at: asc
        }
      ) {
        id
        workflow_run_id
        workflow_step_id
        status
        input
        output
        error
        started_at
        completed_at
        approved_by
        approved_at
      }
    }
  `;

  const response = await fetch(HASURA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({
      query,
      variables: {
        run_id: workflowRunId,
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Hasura returned HTTP ${response.status}: ${text}`
    );
  }

  let result: any;

  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(
      `Hasura returned invalid JSON: ${text.substring(0, 500)}`
    );
  }

  if (result.errors?.length) {
    throw new Error(
      result.errors
        .map((error: any) => error.message)
        .join("; ")
    );
  }

  return result.data?.step_runs || [];
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id: workflowId } = await context.params;

  const workflowRunId =
    request.nextUrl.searchParams.get("run_id");

  if (!workflowId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Workflow ID is required.",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  if (!workflowRunId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "run_id query parameter is required.",
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  const encoder = new TextEncoder();

  let interval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const closeStream = () => {
        if (closed) return;

        closed = true;

        if (interval) {
          clearInterval(interval);
          interval = null;
        }

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;

        const message =
          `event: ${event}\n` +
          `data: ${JSON.stringify(data)}\n\n`;

        try {
          controller.enqueue(
            encoder.encode(message)
          );
        } catch {
          closeStream();
        }
      };

      const checkStatus = async () => {
        if (closed) return;

        try {
          const [run, steps] = await Promise.all([
            getRunStatus(workflowRunId),
            getStepRuns(workflowRunId),
          ]);

          if (!run) {
            send("error", {
              error: "Workflow run not found.",
            });

            closeStream();
            return;
          }

          if (run.workflow_id !== workflowId) {
            send("error", {
              error:
                "Workflow run does not belong to this workflow.",
            });

            closeStream();
            return;
          }

          send("progress", {
            workflow_run: run,
            steps,
            timestamp: new Date().toISOString(),
          });

          if (
            run.status === "completed" ||
            run.status === "failed"
          ) {
            send("complete", {
              workflow_run: run,
              steps,
            });

            closeStream();
          }
        } catch (error) {
          send("error", {
            error:
              error instanceof Error
                ? error.message
                : "Failed to get workflow progress.",
          });

          closeStream();
        }
      };

      // Send the first update immediately.
      await checkStatus();

      if (!closed) {
        // Poll Hasura every second and push updates
        // to the browser using Server-Sent Events.
        interval = setInterval(
          checkStatus,
          1000
        );
      }
    },

    cancel() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}