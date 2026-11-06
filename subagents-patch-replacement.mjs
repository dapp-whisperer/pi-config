import fs from 'node:fs';

// Share anchor accounting, not patch transactions: callers own validation and writes.
export function createGuardedReplacement(changes,states,anchorError) {
 return (file,before,after)=>{
  const text=changes.get(file)??fs.readFileSync(file,'utf8');
  const newCount=text.split(after).length-1;
  const oldCount=text.replaceAll(after,'').split(before).length-1;
  if(oldCount===1&&newCount===0){states.push('original');changes.set(file,text.replace(before,after));}
  else if(oldCount===0&&newCount===1) states.push('patched');
  else throw Error(anchorError(file));
 };
}
