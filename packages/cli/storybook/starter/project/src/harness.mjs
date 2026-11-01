/* global window, location */
/** Opt-in entry point for a trusted, self-contained Vite portable-story build. */
export async function mountStoryHarness({stories,beforeAll,versions,globals={}}) {
  const id=location.hash.slice(1);
  const story=Object.values(stories).find(value=>value.id===id);
  const state={schemaVersion:1,id,status:'running',versions,args:null,globals:null};
  window.__STYLECON_STORY__=state;
  try {
    if(!story)throw new Error('Unknown story');
    const serializable=value=>JSON.parse(JSON.stringify(value,(_key,item)=>{if(item===undefined||typeof item==='function'||typeof item==='symbol'||typeof item==='bigint'||typeof item==='number'&&!Number.isFinite(item))throw new Error('Only JSON story state is supported');return item;}));
    state.args=serializable(story.args??{});
    state.globals=serializable(globals);
    if(story.tags?.some(tag=>['stylecon-skip','!test'].includes(tag))){state.status='skipped';return;}
    await beforeAll?.();
    await story.run({globals:state.globals});
    state.status='completed';
  }catch{state.status='error';}
}
