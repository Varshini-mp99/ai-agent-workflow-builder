import { NextResponse } from "next/server";

const HASURA_URL =
  process.env.HASURA_GRAPHQL_URL || "http://localhost:8500/v1/graphql";

const ADMIN_SECRET =
  process.env.HASURA_GRAPHQL_ADMIN_SECRET || "dev-admin-secret";

const DEFAULT_ORG_ID =
  "98ec58e9-f066-4a74-9255-727e14ef7662";

const DEFAULT_USER_ID =
  "11111111-1111-1111-1111-111111111111";

export async function GET() {
  const query = `
    query GetWorkflows($orgId: uuid!) {
      workflows(
        where: { org_id: { _eq: $orgId } }
        order_by: { created_at: desc }
      ) {
        id
        org_id
        name
        description
        created_by
        created_at
        updated_at
      }
    }
  `;

  try {
    const response = await fetch(HASURA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hasura-admin-secret": ADMIN_SECRET,
      },
      body: JSON.stringify({
        query,
        variables: {
          orgId: DEFAULT_ORG_ID,
        },
      }),
      cache: "no-store",
    });

    const result = await response.json();

    if (result.errors) {
      return NextResponse.json(
        { error: result.errors },
        { status: 500 }
      );
    }

    return NextResponse.json(result.data.workflows);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Unable to connect to Hasura" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "Workflow name is required" },
        { status: 400 }
      );
    }

    const mutation = `
      mutation CreateWorkflow(
        $orgId: uuid!
        $name: String!
        $description: String
        $createdBy: uuid!
      ) {
        insert_workflows_one(
          object: {
            org_id: $orgId
            name: $name
            description: $description
            created_by: $createdBy
          }
        ) {
          id
          org_id
          name
          description
          created_by
          created_at
          updated_at
        }
      }
    `;

    const response = await fetch(HASURA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hasura-admin-secret": ADMIN_SECRET,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          orgId: DEFAULT_ORG_ID,
          name,
          description: description || null,
          createdBy: DEFAULT_USER_ID,
        },
      }),
      cache: "no-store",
    });

    const result = await response.json();

    if (result.errors) {
      return NextResponse.json(
        { error: result.errors },
        { status: 500 }
      );
    }

    return NextResponse.json(
      result.data.insert_workflows_one,
      { status: 201 }
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Unable to create workflow" },
      { status: 500 }
    );
  }
}