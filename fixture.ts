import {createHash} from 'node:crypto';
import {db} from './src/integrations/db/client.js';
const id=(n:string)=>createHash('sha256').update(`hadron-e2e:${n}`).digest('hex').slice(0,32);
const entries=[];
for(const org of ['e2e-alpha','e2e-beta']){
 const memoryId=id('qa1520:'+org+':memory'),agentId=id('qa1520:'+org+':agent'),nodeId=id('qa1520:'+org+':entry');
 await db.memory.create({data:{id:memoryId,organizationId:id(org),urn:org+':qa1520-system',name:'QA1520 Team register',class:'system',tags:['e2e']}});
 await db.agent.create({data:{id:agentId,organizationId:id(org),urn:org+':qa1520-team',name:'QA1520 Team Agent',systemMemoryId:memoryId,visibility:'ORGANIZATION'}});
 await db.node.create({data:{id:id('qa1520:'+org+':roles'),memoryId,loc:'roles',name:'roles',content:'Synthetic Team Agent roles fixture.'}});
 await db.node.create({data:{id:nodeId,memoryId,loc:'register:qa.browser.check',name:'QA1520 readable action entry',content:'# QA1520 action entry\n\nSynthetic browser acceptance fixture.',data:{registerEntry:{code:'qa.browser.check',taskLoc:'tasks:check'}}}});
 entries.push({org,memoryId,agentId,nodeId,urn:`hrn:action:${org}:qa1520-team:qa.browser.check`});
}
console.log(JSON.stringify(entries));await db.$disconnect();
