/**
 * Static runner-owned program; directory descriptors prevent redirection through mutable parents.
 *
 * Each written package becomes an exact copy: files outside its manifest are removed from its
 * directory. With `keep`, every entry of the skill root outside that name list is removed too.
 */
export const SKILL_SYNC_PROGRAM = String.raw`
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),flags=require('node:fs').constants;
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/,STAGING=/^\.osinara-skill-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
async function main(){
  if(!process.env.HOME||!path.isAbsolute(process.env.HOME))throw new Error('AGENT_SKILL_SYNC_HOME_INVALID');
  const chunks=[];let inputBytes=0;
  for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);inputBytes+=bytes.length;if(inputBytes>64*1024*1024)throw new Error('AGENT_SKILL_SYNC_TOO_LARGE');chunks.push(bytes)}
  const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))),root=path.join(process.env.HOME,'.agents','skills');
  const directories=new Map(),directoryFlags=flags.O_RDONLY|flags.O_DIRECTORY|flags.O_NOFOLLOW;
  const entry=(handle,name)=>'/proc/self/fd/'+handle.fd+'/'+name;
  async function directory(target,create){
    if(!directories.has('/'))directories.set('/',{handle:await fs.open('/',directoryFlags)});
    let current='/',parent=directories.get('/').handle;
    for(const name of path.resolve(target).split('/').filter(Boolean)){
      current=path.join(current,name);const cached=directories.get(current);if(cached){parent=cached.handle;continue}
      let handle;
      try{handle=await fs.open(entry(parent,name),directoryFlags)}catch(error){
        if(error.code==='ENOENT'){
          if(!create)return null;
          try{await fs.mkdir(entry(parent,name))}catch(mkdirError){if(mkdirError.code!=='EEXIST')throw mkdirError}
          handle=await fs.open(entry(parent,name),directoryFlags);
        }else if(error.code==='ELOOP'||error.code==='ENOTDIR')throw new Error('AGENT_SKILL_SYNC_PATH_UNSAFE',{cause:error});else throw error;
      }
      directories.set(current,{handle,parent,name});parent=handle;
    }return parent;
  }
  async function verifyDirectories(){
    for(const value of directories.values()){if(!value.parent)continue;let info;
      try{info=await fs.lstat(entry(value.parent,value.name))}catch(error){if(error.code==='ENOENT')throw new Error('AGENT_SKILL_SYNC_PATH_CHANGED',{cause:error});throw error}
      const opened=await value.handle.stat();
      if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==opened.dev||info.ino!==opened.ino)throw new Error('AGENT_SKILL_SYNC_PATH_CHANGED');
    }
  }
  async function matches(parent,name,bytes){
    const target=entry(parent,name);let info;
    try{info=await fs.lstat(target)}catch(error){if(error.code==='ENOENT')return false;throw error}
    if(!info.isFile()||info.isSymbolicLink())throw new Error('AGENT_SKILL_SYNC_PATH_UNSAFE');
    if(info.size!==bytes.length)return false;
    let handle;
    try{handle=await fs.open(target,flags.O_RDONLY|flags.O_NOFOLLOW|flags.O_NONBLOCK)}catch(error){
      if(error.code==='ENOENT'||error.code==='EACCES')return false;
      if(error.code==='ELOOP')throw new Error('AGENT_SKILL_SYNC_PATH_UNSAFE',{cause:error});throw error;
    }
    try{
      if(!(await handle.stat()).isFile())throw new Error('AGENT_SKILL_SYNC_PATH_UNSAFE');
      const buffer=Buffer.alloc(bytes.length+1);let offset=0;
      while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,offset);if(result.bytesRead===0)break;offset+=result.bytesRead}
      return offset===bytes.length&&buffer.subarray(0,offset).equals(bytes);
    }finally{await handle.close()}
  }
  async function removeEntry(parent,name){
    const target=entry(parent,name);let info;
    try{info=await fs.lstat(target)}catch(error){if(error.code==='ENOENT')return false;throw error}
    if(!info.isDirectory()||info.isSymbolicLink()){await fs.unlink(target);return true}
    const handle=await fs.open(target,directoryFlags);
    try{for(const child of await fs.readdir('/proc/self/fd/'+handle.fd))await removeEntry(handle,child)}finally{await handle.close()}
    await fs.rmdir(target);return true;
  }
  async function pruneTree(handle,prefix,files){
    let count=0;
    for(const name of await fs.readdir('/proc/self/fd/'+handle.fd)){
      const relative=prefix?prefix+'/'+name:name,info=await fs.lstat(entry(handle,name));
      if(info.isDirectory()&&!info.isSymbolicLink()&&files.some(file=>file.startsWith(relative+'/'))){
        const child=await fs.open(entry(handle,name),directoryFlags);
        try{count+=await pruneTree(child,relative,files)}finally{await child.close()}
      }else if(!(info.isFile()&&files.includes(relative))&&await removeEntry(handle,name))count++;
    }
    return count;
  }
  const writes=[];let checked=0,removed=0;
  try{
    for(const pkg of request.packages){
      if(!NAME.test(pkg.name))throw new Error('AGENT_SKILL_SYNC_NAME_INVALID');
      for(const file of pkg.files){
        if(file.path.includes('\\')||file.path.includes('\0')||file.path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('AGENT_SKILL_SYNC_PATH_INVALID');
        const target=path.join(root,pkg.name,file.path),bytes=Buffer.from(file.contentBase64,'base64'),parent=await directory(path.dirname(target),false);
        checked++;if(!parent||!await matches(parent,path.basename(target),bytes))writes.push({target,bytes});
      }
    }
    const keep=request.keep===undefined?null:request.keep;
    if(keep&&keep.some(name=>!NAME.test(name)))throw new Error('AGENT_SKILL_SYNC_NAME_INVALID');
    await verifyDirectories();
    const staging=await directory(root,writes.length>0);
    // A killed process cannot execute finally. Keep staging at one reserved root level so the
    // next volume-locked pass can reclaim leftovers without scanning arbitrary package trees.
    if(staging)for(const name of await fs.readdir('/proc/self/fd/'+staging.fd)){
      if(!STAGING.test(name))continue;
      const target=entry(staging,name),info=await fs.lstat(target);
      if(info.isFile()||info.isSymbolicLink())await fs.unlink(target);
    }
    for(const {target,bytes} of writes){
      const parent=await directory(path.dirname(target),true),temporary=entry(staging,'.osinara-skill-'+crypto.randomUUID());
      try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o644});await fs.rename(temporary,entry(parent,path.basename(target)))}finally{await fs.rm(temporary,{force:true})}
    }
    const parent=await directory(root,false);
    if(parent){
      for(const pkg of request.packages){
        const own=await directory(path.join(root,pkg.name),false);
        if(own)removed+=await pruneTree(own,'',pkg.files.map(file=>file.path));
      }
      if(keep)for(const name of await fs.readdir('/proc/self/fd/'+parent.fd)){
        if(!keep.includes(name)&&!STAGING.test(name)&&await removeEntry(parent,name))removed++;
      }
    }
    await verifyDirectories();
    process.stdout.write(JSON.stringify({checked,written:writes.length,removed}));
  }finally{await Promise.all([...directories.values()].map(value=>value.handle.close()))}
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
`;
