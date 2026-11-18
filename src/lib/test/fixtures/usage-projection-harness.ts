import { mount } from 'svelte';
import Panel from '$lib/components/usage/UsagePanel.svelte';
import { accountKey } from '$lib/usage-projection/identity';
import type { UsageView, UsageWindow } from '$lib/usage-projection/types';
const a={account:'Account one',host:'host-one',family:'codex',newestSnapshotAt:'2026-11-11T01:00:00Z',workers:['Mia','Ruth'],workersConfigured:true};
const b={...a,account:'Account two'}, c={...a,account:'Chosen target'};
const w:UsageWindow={window:'FIVE_HOUR',lengthMinutes:300,status:'PROJECTED',reason:null,usedPct:20,resetsAt:'2026-11-11T04:00:00Z',observedAt:a.newestSnapshotAt,lowPctAtReset:33.6,highPctAtReset:34.4,burn:null,perWorkerBurn:{lowPctPerHour:0.2,highPctPerHour:0.8},confidence:'HIGH',shape:'FLAT',runsOutAt:null,ceilingPct:85};
export function mountUsage(target:HTMLElement,variant:'add'|'move'){
 const projection={account:a.account,host:a.host,family:a.family,asOf:a.newestSnapshotAt,newestSnapshotAt:a.newestSnapshotAt,workers:a.workers,workersConfigured:true,windows:[w],whatIf:null};
 const moving=variant==='move';
 const view:UsageView={kind:'ok',accounts:[a,b,c],complete:true,asOf:projection.asOf,selected:a,invalid:false,target:moving?c:null,question:moving?{kind:'move',worker:'Ruth',targetKey:accountKey(c)}:{kind:'add',count:3},projection:{kind:'ok',value:projection},whatIf:{kind:'ok',value:{...projection,whatIf:{adjusted:[{...w,lowPctAtReset:40,highPctAtReset:60}],target:moving?{account:c.account,baseline:[w],adjusted:[w]}:null}}}};
 return mount(Panel,{target,props:{view,path:'/usage'}});
}
