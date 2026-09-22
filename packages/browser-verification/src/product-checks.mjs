export function appendProductChecks(report, observations) {
  const checks=[...report.checks];
  const add=(check,ruleId,target,value,observed,fix)=>checks.push({check,ruleId,target,status:value===true?'pass':value===false?'fail':'not_checked',observed,fix});
  if(observations.form) {
    const f=observations.form;
    add('label','STYLE-A11Y-003',f.selector,f.found?f.labelled:undefined,{label:f.label},'Associate a visible label with this input.');
    add('error-association','STYLE-A11Y-006',f.selector,f.found?f.invalid && f.errorAssociated && f.errorVisible && f.focused:undefined,{invalid:f.invalid,error:f.errorText,focused:f.focused},'Identify invalid input with associated visible correction text and preserve focus.');
  }
  for(const s of observations.states??[]) {
    add(s.kind,s.kind==='disabled'?'PROJECT-DISABLED-001':'PROJECT-LOADING-001',s.selector,s.found?s.kind==='disabled'?s.nativeDisabled:s.busy && s.statusVisible:undefined,s,'Meet the declared disabled/loading contract. Product check, not a canonical WCAG claim.');
  }
  if(observations.layout) {
    const l=observations.layout;
    add('overflow','PROJECT-LAYOUT-001','page',Number.isFinite(l.viewportWidth)&&l.viewportWidth>0&&Number.isFinite(l.contentWidth)?l.contentWidth<=l.viewportWidth:undefined,l,'Remove unintended horizontal page overflow at this viewport.');
  }
  for(const path of observations.closePaths??[]) add('close-path','STYLE-A11Y-012','dialog',path.closed===undefined?undefined:path.closed&&path.returnFocus,path,'Close this dialog and restore focus through the configured action.');
  return {...report,checks,status:checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')?'pass':'not_checked',
    limitations:[...(report.limitations??[]),'Form error checks measure text presence, association and focus location; correction accuracy and invalid-input focus visibility/contrast require separate review.','Declared loading/disabled states and current viewport only; no background-operation or general responsive-layout proof.']};
}
