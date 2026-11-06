import { Building2 } from "lucide-react";
import { request } from "../../lib/api.ts";
import type { WorkbenchModule } from "../types.ts";
import { PropertyAdmin } from "./Admin.tsx";
import { PropertyPage } from "./Property.tsx";
export const property: WorkbenchModule = {
 id: "property", apiVersion: 1, access: "role",
 routes: [{path:"property", element:<PropertyPage/>}],
 nav: [{key:"property",label:"Property",to:"property",icon:Building2}],
 admin:{label:"Property",icon:Building2,Settings:PropertyAdmin},
 setup:[{key:"property-project",label:"Create your property project",to:"admin?tab=property",check:async()=>(await request<{project:unknown}>("/api/modules/property/settings")).project!==null}],
 eventLabel: kind=>kind==="announcement.created"?"A new property announcement is available":kind==="assigned_task.created"?"A property task was assigned to you":kind==="assigned_task.due"?"A property task is due soon":kind==="followup.overdue"?"A property follow-up is overdue":kind==="work_order.overdue"?"A property work order is overdue":kind.startsWith("work_order.")?"A property work order was updated":kind,
};
