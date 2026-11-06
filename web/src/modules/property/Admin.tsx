import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Plus, Pencil, ShieldCheck } from "lucide-react";
import { request, ApiError } from "../../lib/api.ts";
import { Dialog } from "../../lib/ui.tsx";
import { useWorkspace } from "../../shell/workspace.ts";
import { listMembers, listRoles, listAssignments } from "../../admin/api.ts";
import { RegistryImports } from "./RegistryImports.tsx";
import "./property.css";
const root="/api/modules/property";
export type Building={id:string;name:string;revision:number};
export type EditableRoom={id:string;room_no:string;building_id:string;area:string;occupancy_status:string;revision:number;account_no:string};
type Project={id:string;name:string;timezone:string;revision:number};
type Binding={assignment_id:string;user_id:string;mode:string;revision:number;buildings:string[];ends_at:string|null};
type Settings={project:Project|null;scopes:Binding[]};
type Editor={kind:"project";item?:Project}|{kind:"building";item?:Building}|{kind:"room";item?:EditableRoom}|{kind:"account";room:EditableRoom};
function errorText(err:unknown){if(err instanceof ApiError){if(err.status===409)return "This record changed or its number already exists. Close this form, refresh and review before trying again.";if(err.status===400)return "Check the required fields, numbers and selected records.";if(err.status===403)return "You no longer have permission to change property setup.";}return "Could not save. Your changes remain here; try again.";}
export function useCommand(){
 const {tenant}=useWorkspace();const client=useQueryClient();const receipt=useRef<{body:string;key:string}>();
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 async function save(kind:string,body:unknown,admin=true){const encoded=JSON.stringify(body);if(receipt.current?.body!==kind+encoded)receipt.current={body:kind+encoded,key:crypto.randomUUID()};setBusy(true);setError("");
 try{await request(root+(admin?"/admin/":"/")+kind,{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":receipt.current.key},body:encoded});receipt.current=undefined;await client.invalidateQueries({queryKey:["property",tenant]});return true;}catch(e){setError(errorText(e));return false;}finally{setBusy(false)}}
 return {save,busy,error};
}
export function RegistryEditor({editor,buildings,onClose}:{editor:Editor;buildings:Building[];onClose():void}){
 const cmd=useCommand();const item="item" in editor?editor.item:undefined;
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const body:Record<string,unknown>={revision:item?.revision??0};if(item)body.id=item.id;
 for(const [key,value]of data.entries())body[key]=value;
 if(editor.kind==="account")body.room_id=editor.room.id;
 if(await cmd.save(editor.kind,body))onClose();
 }
 const title=(item?"Edit ":"Add ")+editor.kind;
 return <Dialog label={title} onClose={cmd.busy?undefined:onClose}><form className="property-editor" onSubmit={submit}><h2>{title}</h2>
 {(editor.kind==="project"||editor.kind==="building")&&<label>Name<input name="name" required maxLength={160} defaultValue={item&&"name" in item?item.name:""}/></label>}
 {editor.kind==="project"&&<label>Project timezone<input name="timezone" required defaultValue={editor.item?.timezone??"Asia/Shanghai"} readOnly={!!editor.item}/><small>The timezone is fixed after setup to preserve calendar and billing history.</small></label>}
 {editor.kind==="room"&&<><label>Building<select name="building_id" aria-label="Building" required defaultValue={editor.item?.building_id??""} disabled={!!editor.item}><option value="">Choose a building</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{editor.item&&<input type="hidden" name="building_id" aria-label="Building" value={editor.item.building_id}/>}
 <label>Room number<input name="room_no" required maxLength={160} defaultValue={editor.item?.room_no??""} readOnly={!!editor.item}/></label><label>Floor area (m²)<input name="area" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,4})?" defaultValue={editor.item?.area??""}/></label><label>Occupancy<select name="occupancy_status" aria-label="Occupancy" defaultValue={editor.item?.occupancy_status??"vacant"}><option value="unknown">Not recorded</option><option value="vacant">Vacant</option><option value="owner_occupied">Owner occupied</option><option value="rented">Rented</option><option value="occupied">Occupied (legacy)</option></select></label></>}
 {editor.kind==="account"&&<><p>New billing account for room {editor.room.room_no}. The room’s historical accounts will remain unchanged.</p><label>Account number<input name="account_no" required maxLength={160}/></label></>}
 {cmd.error&&<p role="alert" className="property-form-error">{cmd.error}</p>}<div className="property-form-actions"><button type="button" disabled={cmd.busy} onClick={onClose}>Cancel</button><button disabled={cmd.busy} type="submit">{cmd.busy?"Saving…":"Save"}</button></div></form></Dialog>;
}
export function PropertyAdmin(){const {tenant}=useWorkspace();return <AdminWorkspace key={tenant}/>;}
function AdminWorkspace(){
 const {tenant}=useWorkspace();const [editor,setEditor]=useState<Editor>();
 const settings=useQuery({queryKey:["property",tenant,"settings"],queryFn:()=>request<Settings>(root+"/settings"),retry:false});
 const registry=useQuery({queryKey:["property",tenant,"admin-registry"],queryFn:()=>request<{buildings:Building[]}>(root+"/registry"),retry:false});
 const members=useQuery({queryKey:["org",tenant,"members"],queryFn:()=>listMembers(tenant)});
 const roles=useQuery({queryKey:["org",tenant,"roles","list"],queryFn:()=>listRoles(tenant)});
 const activity=useQuery({queryKey:["property",tenant,"activity"],queryFn:()=>request<{records:{id:string;at:string;action:string;actor:{id:string};target:string;outcome:string}[]}>(root+"/admin/activity")});
 const buildings=registry.data?.buildings??[];
 const [user,setUser]=useState("");const [assignment,setAssignment]=useState("");const [mode,setMode]=useState("selected");const [selected,setSelected]=useState<string[]>([]);const [notice,setNotice]=useState("");
 const assignments=useQuery({queryKey:["org",tenant,"roles","member",user],queryFn:()=>listAssignments(tenant,user),enabled:!!user});
 const cmd=useCommand();const binding=settings.data?.scopes.find(b=>b.assignment_id===assignment);
 const chooseAssignment=(id:string)=>{setAssignment(id);const b=settings.data?.scopes.find(x=>x.assignment_id===id);setMode(b?.ends_at?"disabled":b?.mode??"selected");setSelected(b?.buildings??[]);setNotice("");};
 if(settings.isPending)return <p role="status">Loading property setup…</p>;
 if(settings.isError)return <p role="alert">Property setup could not be loaded. Tenant administrator access is required.</p>;
 return <div className="property-admin-workspace">
 <section className="property-card"><div className="property-section"><div><h2>Project setup</h2><p>{settings.data.project?.name??"Set up your property project"}</p></div><button onClick={()=>setEditor({kind:"project",item:settings.data.project??undefined})}><Pencil size={15}/>{settings.data.project?"Edit project":"Set up project"}</button></div>{settings.data.project&&<p className="property-footnote">Timezone: {settings.data.project.timezone}</p>}</section>
 <section className="property-card"><div className="property-section"><div><h2>Buildings</h2><p>Buildings define the boundaries of employee responsibility.</p></div><button disabled={!settings.data.project} onClick={()=>setEditor({kind:"building"})}><Plus size={15}/>Add building</button></div><div className="property-access-list">{buildings.map(b=><div key={b.id}><span>{b.name}</span><button onClick={()=>setEditor({kind:"building",item:b})}>Rename</button></div>)}{!buildings.length&&<p>No buildings registered yet.</p>}</div></section>
 <RegistryImports/>
 <section className="property-card"><div className="property-section"><div><h2><ShieldCheck size={17}/> Building responsibility</h2><p>Attach property scope to a person’s existing business role. Manage roles in Administration → Roles.</p></div></div><form className="property-editor" onSubmit={async e=>{e.preventDefault();if(await cmd.save("scope",{assignment_id:assignment,user_id:user,mode,buildings:mode==="selected"?selected:[],revision:binding?.revision??0})){setNotice("Scope saved. It takes effect on the next request.")}}}>
 <label>Employee<select aria-label="Employee" value={user} required onChange={e=>{setUser(e.target.value);setAssignment("");setNotice("")}}><option value="">Choose an employee</option>{members.data?.filter(m=>m.status==="active"&&m.user_status==="active").map(m=><option key={m.user_id} value={m.user_id}>{m.name}</option>)}</select></label>
 <label>Business role<select aria-label="Business role" required value={assignment} onChange={e=>chooseAssignment(e.target.value)} disabled={!user||assignments.isPending}><option value="">Choose an assigned role</option>{assignments.data?.filter(a=>a.status==="active"&&roles.data?.some(r=>r.id===a.role_id&&r.enabled&&r.permissions.some(p=>p.startsWith("property:")))).map(a=><option key={a.id} value={a.id}>{roles.data?.find(r=>r.id===a.role_id)?.name??a.role_id}</option>)}</select></label>
 <label>Scope<select aria-label="Scope" value={mode} onChange={e=>setMode(e.target.value)}><option value="selected">Selected buildings</option><option value="all">Whole project</option><option value="assigned_work">Assigned work only</option>{binding&&<option value="disabled">Disable property scope</option>}</select></label>
 {mode==="selected"&&<fieldset><legend>Permitted buildings</legend>{buildings.map(b=><label className="property-check" key={b.id}><input type="checkbox" checked={selected.includes(b.id)} onChange={e=>setSelected(e.target.checked?[...selected,b.id]:selected.filter(x=>x!==b.id))}/>{b.name}</label>)}<small>No selected buildings means no building access.</small></fieldset>}
 <p>Scope only applies to actions granted by this role. A broad read role cannot widen another role’s write access.</p>
 {cmd.error&&<p role="alert" className="property-form-error">{cmd.error}</p>}{notice&&<p role="status">{notice}</p>}<div className="property-form-actions"><button disabled={!assignment||cmd.busy} type="submit">{cmd.busy?"Saving…":"Save responsibility"}</button></div></form></section>
 <section className="property-card"><div className="property-section"><h2>Property activity</h2></div><div className="property-access-list">{activity.data?.records.map(a=><div key={a.id}><span>{a.action} · {a.outcome}<small style={{display:"block"}}>{members.data?.find(m=>m.user_id===a.actor.id)?.name??a.actor.id}</small></span><time dateTime={a.at}>{new Date(a.at).toLocaleString()}</time></div>)}{activity.data?.records.length===0&&<p>No recorded changes yet.</p>}{activity.isError&&<p role="alert">Activity could not be loaded.</p>}</div></section>
 {editor&&<RegistryEditor editor={editor} buildings={buildings} onClose={()=>setEditor(undefined)}/>}
 </div>;
}
export function RoomEditor({room,buildings,onClose}:{room?:EditableRoom;buildings:Building[];onClose():void}){return <RegistryEditor editor={{kind:"room",item:room}} buildings={buildings} onClose={onClose}/>;}
