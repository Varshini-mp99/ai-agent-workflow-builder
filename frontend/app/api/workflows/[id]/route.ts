import { NextRequest, NextResponse } from "next/server";

const HASURA_URL =
  process.env.HASURA_GRAPHQL_URL ||
  "http://localhost:8500/v1/graphql";

const HASURA_ADMIN_SECRET =
  process.env.HASURA_GRAPHQL_ADMIN_SECRET ||
  "dev-admin-secret";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Workflow ID is required" },
        { status: 400 }
      );
    }

    const query = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          org_id
          name
          description
          created_by
          created_at
          updated_at

          workflow_steps(
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
            created_at
          }

          workflow_triggers(
            order_by: {
              created_at: asc
            }
          ) {
            id
            workflow_id
            trigger_type
            config
            enabled
            created_at
          }
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
        variables: { id },
      }),
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            result?.error ||
            result?.message ||
            "Hasura request failed",
        },
        { status: 500 }
      );
    }

    if (result.errors) {
      return NextResponse.json(
        {
          error: result.errors
            .map(
              (error: { message: string }) =>
                error.message
            )
            .join(", "),
        },
        { status: 500 }
      );
    }

    const workflow = result?.data?.workflows_by_pk;

    if (!workflow) {
      return NextResponse.json(
        {
          error: "Workflow not found",
          workflowId: id,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      workflow,
      steps: workflow.workflow_steps || [],
      triggers: workflow.workflow_triggers || [],
    });
  } catch (error) {
    console.error("Workflow API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load workflow",
      },
      { status: 500 }
    );
  }
}