import { NextRequest, NextResponse } from "next/server";

const HASURA_URL =
  process.env.HASURA_URL ||
  "http://localhost:8500/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.HASURA_ADMIN_SECRET ||
  "dev-admin-secret";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
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

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          error: "Workflow ID is required",
        },
        {
          status: 400,
        }
      );
    }

    const data = await hasura(
      `
      query GetWorkflowRuns(
        $workflow_id: uuid!
      ) {
        workflow_runs(
          where: {
            workflow_id: {
              _eq: $workflow_id
            }
          }
          order_by: {
            created_at: desc
          }
          limit: 20
        ) {
          id
          workflow_id
          triggered_by
          status
          started_at
          completed_at
          error
          created_at

          step_runs(
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
            attempt_count
            started_at
            completed_at
            created_at

            workflow_step {
              id
              step_order
              name
              type
            }
          }
        }
      }
      `,
      {
        workflow_id: id,
      }
    );

    return NextResponse.json({
      runs: data.workflow_runs || [],
    });
  } catch (error) {
    console.error(
      "Execution history error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load execution history",
      },
      {
        status: 500,
      }
    );
  }
}