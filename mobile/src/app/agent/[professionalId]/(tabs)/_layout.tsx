import { WorkspaceTabs } from "@/workspace/shell";

export default function ProfessionalTabs() {
  return (
    <WorkspaceTabs
      kind="professional"
      tabs={[
        { name: "index", title: "Dashboard", icon: "grid" },
        { name: "listings", title: "Listings", icon: "home" },
        { name: "leads", title: "Enquiries", icon: "chatbubbles" },
        { name: "more", title: "More", icon: "ellipsis-horizontal-circle" },
      ]}
    />
  );
}
