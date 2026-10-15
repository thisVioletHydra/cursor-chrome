// Translate the migrated planner's semantic steps into the six browser primitives.
// All field matching, resume choice, submission and confirmation decisions run here on the server.
import type { Cmd, Enqueue, Outcome } from './types.ts';
import { FORM_SEL } from './form.ts';
type Field = {id:string; name?:string; type?:string; selector?:string; label?:string; required?:boolean; value?:string; options?:Array<string|{text:string;value:string}>};
type Dom = {html?:string; found?:boolean; fields?:Field[]; controls?:Array<{selector:string;text:string}>};
const quote = (s:string) => JSON.stringify(s).replace(/\\n/g,'\\a ');
const selector = (f:Field) => f.selector || (f.id ? `[id=${quote(f.id)}]` : f.name ? `[name=${quote(f.name)}]` : '');
const sent = (dom:Dom) => /Вы откликнулись|Отклик отправлен|vacancy-response-link-view-topic|Резюме доставлено/i.test(dom.html || '');
const human = (reason:string):Outcome => ({ok:true,result:{status:'needsHuman',reason}});
export function primitivePlanner(send: Enqueue): Enqueue {
  return async (login, cmd, options) => {
    if (cmd.kind === 'snapshot') return send(login,{kind:'readDOM',params:{...cmd.params,mode:'snapshot'}},options);
    if (cmd.kind === 'read') return send(login,{kind:'readDOM',params:{...cmd.params,mode:'text'}},options);
    if (cmd.kind !== 'hh_apply') return send(login,cmd,options);
    const issue = (kind:Cmd['kind'],params:Record<string,unknown>) => send(login,{kind,params},options);
    const read = async (sel=FORM_SEL.root):Promise<Dom|null> => {
      const r=await issue('readDOM',{mode:'snapshot',selector:sel,maxChars:100000});
      return r.ok ? r.result as Dom : null;
    };
    let dom=await read();
    if (!dom || dom.found === false) return human('форма закрыта; повтор отклика запрещён');
    if (sent(dom)) return {ok:true,result:{status:'sent'}};
    const answers=(cmd.params.answers || {}) as Record<string,unknown>;
    const kind=answers.__resumeKind;
    if (kind==='frontend' || kind==='fullstack') {
      const match=kind==='frontend'? /front[\s-]?end|фронтенд/i : /full[\s-]?stack|фул+стек/i;
      const native=(dom.fields || []).filter(f=>f.type==='select').flatMap(f=>(f.options || []).filter(o=>match.test(typeof o==='string'?o:o.text)).map(o=>({f,o})))[0];
      if (native) {
        const r=await issue('select',{selector:selector(native.f),values:[typeof native.o==='string'?native.o:native.o.value]});
        if (!r.ok) return r;
      } else {
        const trigger=dom.controls?.find(c=>/резюме|разработчик|frontend|fullstack/i.test(c.text));
        if (trigger && !match.test(trigger.text)) {
          const opened=await issue('click',{selector:trigger.selector}); if(!opened.ok)return opened;
          const menu=await read('[role="listbox"], [data-qa*="select-options"]');
          const option=menu?.controls?.find(c=>match.test(c.text));
          if (!option) return human('нужное резюме не найдено');
          const chosen=await issue('click',{selector:option.selector}); if(!chosen.ok)return chosen;
        }
      }
      dom=await read(); if(!dom)return human('форма не прочитана');
    }
    for (const f of dom.fields || []) {
      if (/resume|letter/i.test(f.name || f.id)) continue;
      const value=answers[f.id] ?? answers[f.name || ''];
      if (value === undefined || String(value).trim()==='') {
        if(f.required && !f.value) return human(`нет ответа: ${f.label || f.id}`);
        continue;
      }
      const sel=selector(f); if(!sel)return human('поле без устойчивого селектора');
      let r:Outcome;
      if (f.type==='select') {
        const option=f.options?.find(o=>typeof o==='string'?o===String(value):o.text===String(value)||o.value===String(value));
        if(!option)return human(`не найден вариант: ${f.label || f.id}`);
        r=await issue('select',{selector:sel,values:[typeof option==='string'?option:option.value]});
      } else if(f.type==='radio' || f.type==='checkbox') {
        if (String(value)!==f.value && String(value)!==f.label) continue;
        r=await issue('click',{selector:sel});
      } else r=await issue('type',{selector:sel,text:String(value),clear:true});
      if(!r.ok)return r;
    }
    if (typeof cmd.params.letter==='string' && cmd.params.letter) {
      const field=dom.fields?.find(f=>/letter/i.test(f.name || f.id));
      if(!field)return human('поле сопроводительного не найдено');
      const r=await issue('type',{selector:selector(field),text:cmd.params.letter,clear:true}); if(!r.ok)return r;
    }
    const submit=await issue('click',{selector:FORM_SEL.submitButton}); if(!submit.ok)return submit;
    await issue('wait',{ms:1000});
    const final=await read('html');
    return sent(final || {}) ? {ok:true,result:{status:'sent'}} : human('отклик не подтверждён; проверь вручную');
  };
}
