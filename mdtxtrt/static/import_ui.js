import {comparisonDialog} from "/static/dialogs.js";

const importErrors={
  unsupported_import_format:"Use arquivo .md ou .txt.",
  import_file_too_large:"Arquivo acima do limite do Telegram (20 MB).",
  missing_file:"Nenhum arquivo chegou ao servidor.",
  unknown_encoding:"Encoding inválido para este arquivo.",
  invalid_encoding_for_file:"Encoding inválido para este arquivo.",
  internal_error:"Falha interna no servidor ao importar.",
};
export function importErrorMessage(error){
  return importErrors[error.data?.error]||error.message;
}

export function createImportChosen({api,showMessage,loadDraft,openForm,field,conversionSummary}){
  return async function importChosen(file){

  const form=new FormData();
  form.append("file",file,file.name);
  let staged;
  try{staged=await api("/api/import-workflow/stage",{method:"POST",body:form})}
  catch(error){
    if(error.data?.error!=="encoding_choice_required"){
      showMessage("Importação",importErrorMessage(error));
      return;
    }
    staged={pending_import:{id:error.data.pending_import_id},review:null};
  }
  const id=staged.pending_import.id;
  let encoding=null;
  let review=staged.review;
  if(!review){
    const value=await openForm("Escolher encoding",[field("encoding","Encoding — não será adivinhado","text","windows-1252")]);
    if(!value) return;
    encoding=value.encoding;
    try{review=(await api(`/api/import-workflow/${id}/preview`,{method:"POST",body:{encoding}})).review}
    catch(error){showMessage("Importação",importErrorMessage(error));return}
  }
  let confirmPartial=false;
  if(review.requires_partial_confirmation||review.requires_confirmation){
    const source=review.original_text||"";
    const semantic=conversionSummary(source,{
      converted_document:review.converted_document,
      converted_markdown:review.converted_markdown,
      residual_raw_markdown:review.residual_raw_markdown,
      lossless_visual_conversion:review.lossless_visual_import,
    });
    const decision=await comparisonDialog({
      title:"Revisão antes de criar o rascunho",
      summary:semantic,
      leftLabel:"Original preservado",
      leftValue:source,
      rightLabel:"Conversão proposta",
      rightValue:review.converted_markdown||review.converted_text||"",
      choices:[
        {value:"confirm",label:"Criar rascunho com esta conversão parcial",detail:"O original byte a byte continua preservado no registro de importação."},
        {value:"cancel",label:"Manter importação pendente",detail:"Nenhum rascunho definitivo será criado agora."},
      ],
      defaultChoice:"cancel",
      confirmLabel:"Aplicar decisão",
    });
    if(!decision||decision.choice!=="confirm") return;
    confirmPartial=true;
  }
  try{
    const data=await api(`/api/import-workflow/${id}/complete`,{method:"POST",body:{encoding,confirm_partial:confirmPartial}});
    await loadDraft(data.draft.id);
  }catch(error){showMessage("Importação",importErrorMessage(error))}
}
}
