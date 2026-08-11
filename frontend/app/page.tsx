"use client";

import Link from "next/link";

type Workflow = {
  id: string;
  name: string;
  description: string;
  trigger: string;
  runs: number;
  status: string;
};

const workflows: Workflow[] = [
  {
    id: "26bbadf8-c2be-4191-a683-198df060e012",
    name: "Customer Support Agent",
    description:
      "Automatically classify and route customer support requests.",
    trigger: "Manual",
    runs: 0,
    status: "Saved",
  },
  {
    id: "2e2f84ca-705b-4263-b6b4-7c9ff5a9e1f7",
    name: "Customer Support Agent",
    description:
      "Automatically classify and route customer support requests.",
    trigger: "Manual",
    runs: 0,
    status: "Saved",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 flex h-screen w-[290px] flex-col bg-[#10182b] text-white">
        <div className="flex items-center gap-4 px-7 py-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-600 text-xl font-bold">
            AI
          </div>

          <div>
            <h1 className="text-lg font-bold">Workflow Builder</h1>
            <p className="text-sm text-slate-400">Agent Automation</p>
          </div>
        </div>

        <nav className="flex-1 px-4">
          <Link
            href="/"
            className="mb-2 flex items-center gap-4 rounded-xl bg-indigo-600 px-5 py-4 font-semibold"
          >
            <span>⌂</span>
            Dashboard
          </Link>

          <Link
            href="/"
            className="mb-2 flex items-center gap-4 rounded-xl px-5 py-4 font-medium text-slate-300 hover:bg-slate-800"
          >
            <span>◇</span>
            Workflows
          </Link>

          <Link
            href="/"
            className="mb-2 flex items-center gap-4 rounded-xl px-5 py-4 font-medium text-slate-300 hover:bg-slate-800"
          >
            <span>▶</span>
            Runs
          </Link>

          <Link
            href="/"
            className="mb-2 flex items-center gap-4 rounded-xl px-5 py-4 font-medium text-slate-300 hover:bg-slate-800"
          >
            <span>◎</span>
            Organizations
          </Link>
        </nav>

        <div className="px-4 pb-8">
          <Link
            href="/"
            className="mb-5 flex items-center gap-4 rounded-xl px-5 py-4 text-slate-300 hover:bg-slate-800"
          >
            <span>⚙</span>
            Settings
          </Link>

          <div className="border-t border-slate-700 pt-6">
            <div className="flex items-center gap-4 px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600">
                D
              </div>

              <div>
                <p className="font-semibold">Developer</p>
                <p className="text-sm text-slate-400">Owner</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <section className="ml-[290px] min-h-screen px-14 py-12">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-500">
              AI Workflow Platform
            </p>

            <h2 className="mt-3 text-5xl font-bold tracking-tight">
              Dashboard
            </h2>

            <p className="mt-3 text-lg text-slate-500">
              Build, execute and monitor intelligent agent workflows.
            </p>
          </div>

          <Link
            href="/workflows/new"
            className="rounded-xl bg-indigo-600 px-7 py-4 font-bold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700"
          >
            + New Workflow
          </Link>
        </div>

        <div className="mt-10 grid grid-cols-4 gap-6">
          <StatCard
            title="Total Workflows"
            value={String(workflows.length)}
            description="Across your organization"
            icon="◇"
          />

          <StatCard
            title="Total Runs"
            value="0"
            description="Workflow executions"
            icon="▶"
          />

          <StatCard
            title="Success Rate"
            value="100%"
            description="No failed runs yet"
            icon="✓"
          />

          <StatCard
            title="Organization"
            value="AI Labs"
            description="3 members"
            icon="◎"
          />
        </div>

        <div className="mt-14">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold">My Workflows</h2>

              <p className="mt-2 text-slate-500">
                Create and manage your automation workflows.
              </p>
            </div>

            <Link
              href="/workflows/new"
              className="rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold hover:bg-slate-50"
            >
              + Create Workflow
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6">
            {workflows.map((workflow) => (
              <WorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-sm text-slate-500">{title}</p>

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          {icon}
        </div>
      </div>

      <p className="mt-7 text-4xl font-bold">{value}</p>

      <p className="mt-3 text-sm text-emerald-600">{description}</p>
    </div>
  );
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-start justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 font-bold text-indigo-600">
          AI
        </div>

        <span className="rounded-full bg-emerald-100 px-4 py-2 text-xs font-bold text-emerald-700">
          {workflow.status}
        </span>
      </div>

      <h3 className="mt-7 text-xl font-bold">{workflow.name}</h3>

      <p className="mt-3 min-h-[50px] text-sm leading-6 text-slate-500">
        {workflow.description}
      </p>

      <div className="mt-7 border-y border-slate-200 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Trigger: {workflow.trigger}
          </span>

          <span className="text-slate-500">{workflow.runs} runs</span>
        </div>
      </div>

      <Link
        href={`/workflows/${workflow.id}`}
        className="mt-5 flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white py-3.5 font-semibold text-slate-900 transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
      >
        Open Workflow →
      </Link>
    </div>
  );
}