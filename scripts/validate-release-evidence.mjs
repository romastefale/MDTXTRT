import { execFileSync } from 'node:child_process';

const fail=message=>{throw new Error(message);};
const sha=(process.env.RELEASE_ANCHOR_SHA||'').trim();
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(sha))fail('Release Anchor SHA ausente ou inválido');
if(head!==sha)fail(`Workflow executado em ${head}, mas o Release Anchor informado é ${sha}`);
if((process.env.CERTIFICATION_STATUS||'')!=='RELEASE APPROVED')fail('Certificação final não está marcada como RELEASE APPROVED');

const fields=[
  'AUTHORIZATION_EVIDENCE_REF','VISUAL_EVIDENCE_REF','TELEGRAPH_EVIDENCE_REF','TELEGRAM_EVIDENCE_REF',
  'DEVICE_MATRIX_EVIDENCE_REF','FAULT_MATRIX_EVIDENCE_REF','ROLLBACK_EVIDENCE_REF'
];
const pattern=/^https:\/\/github\.com\/romastefale\/MDTXTRT\/(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$/;
const refs={};
for(const field of fields){
  const value=(process.env[field]||'').trim();
  if(!pattern.test(value))fail(`${field} deve apontar para uma issue/PR/comment auditável em romastefale/MDTXTRT`);
  refs[field]=value;
}
console.log(JSON.stringify({ok:true,releaseAnchor:sha,certification:'RELEASE APPROVED',evidence:refs},null,2));
