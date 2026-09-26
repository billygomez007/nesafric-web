import { WorkspaceTabs } from "@/workspace/shell";

export default function ProviderTabs() {
  return (
    <WorkspaceTabs
      kind="provider"
      tabs={[
        { name: "index", title: "Dashboard", icon: "grid" },
        { name: "jobs", title: "Jobs", icon: "hammer" },
        { name: "more", title: "More", icon: "ellipsis-horizontal-circle" },
      ]}
    />
  );
}
