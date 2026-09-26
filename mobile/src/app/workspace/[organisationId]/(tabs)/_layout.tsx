import { WorkspaceTabs } from "@/workspace/shell";

export default function PropertyManagementTabs() {
  return (
    <WorkspaceTabs
      kind="organisation"
      tabs={[
        { name: "index", title: "Dashboard", icon: "grid" },
        { name: "properties", title: "Properties", icon: "business" },
        { name: "tenants", title: "Tenants", icon: "people" },
        { name: "maintenance", title: "Maintenance", icon: "construct" },
        { name: "more", title: "More", icon: "ellipsis-horizontal-circle" },
      ]}
    />
  );
}
