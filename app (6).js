/* A short-lived avatar-only capability is held in memory, never persisted. */
(() => {
 'use strict';
 const words={
  en:{eyebrow:'YOUR PROFILE',title:'Make it yours.',intro:'Choose a photo for your Zoigram profile. It appears next to your posts, comments and messages.',choose:'Choose a photo',hint:'PNG, JPG or WebP · up to 8 MB. Your photo is cropped to a circle from the centre.',save:'Save profile photo',footer:'Opened from your game profile. This link can only change your avatar.',invalid:'Open a new upload link from Edit profile in the game.',large:'Choose a PNG, JPG or WebP image no larger than 8 MB.',saving:'Uploading your photo…',success:'Saved! Return to Zoigram in the game. Your avatar will update automatically.',offline:'Could not upload. Check your connection and try again.'},
  ru:{eyebrow:'ВАШ ПРОФИЛЬ',title:'Ваше лицо в Zoigram.',intro:'Выберите фотографию для профиля. Она появится рядом с вашими публикациями, комментариями и сообщениями.',choose:'Выбрать фотографию',hint:'PNG, JPG или WebP · до 8 МБ. Фото обрезается в круг по центру.',save:'Сохранить аватар',footer:'Страница открыта из вашего игрового профиля. Эта ссылка позволяет менять только аватар.',invalid:'Откройте новую ссылку в редактировании профиля в игре.',large:'Выберите PNG, JPG или WebP размером до 8 МБ.',saving:'Загружаем фотографию…',success:'Готово! Вернитесь в Zoigram в игре. Аватар обновится автоматически.',offline:'Не удалось загрузить фото. Проверьте соединение и повторите.'},
  fr:{eyebrow:'VOTRE PROFIL',title:'À votre image.',intro:'Choisissez une photo pour votre profil Zoigram. Elle apparaîtra à côté de vos publications, commentaires et messages.',choose:'Choisir une photo',hint:'PNG, JPG ou WebP · 8 Mo maximum. La photo est recadrée en cercle depuis le centre.',save:'Enregistrer l’avatar',footer:'Page ouverte depuis votre profil dans le jeu. Ce lien permet uniquement de changer votre avatar.',invalid:'Ouvrez un nouveau lien dans la modification du profil du jeu.',large:'Choisissez une image PNG, JPG ou WebP de 8 Mo maximum.',saving:'Envoi de la photo…',success:'Enregistré ! Retournez dans Zoigram. Votre avatar se mettra à jour automatiquement.',offline:'Échec de l’envoi. Vérifiez votre connexion et réessayez.'},
  ko:{eyebrow:'내 프로필',title:'나만의 프로필.',intro:'Zoigram 프로필에 사용할 사진을 선택하세요. 게시물, 댓글, 메시지 옆에 표시됩니다.',choose:'사진 선택',hint:'PNG, JPG 또는 WebP · 최대 8MB. 사진 중앙을 기준으로 원형으로 잘립니다.',save:'프로필 사진 저장',footer:'게임 프로필에서 연 페이지입니다. 이 링크로는 프로필 사진만 변경할 수 있습니다.',invalid:'게임의 프로필 편집에서 새 업로드 링크를 열어 주세요.',large:'8MB 이하의 PNG, JPG 또는 WebP 이미지를 선택하세요.',saving:'사진 업로드 중…',success:'저장했습니다! 게임의 Zoigram으로 돌아가세요. 프로필 사진이 자동으로 업데이트됩니다.',offline:'업로드하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'}
 };
 const language=new URLSearchParams(location.search).get('lang')||navigator.language.split('-')[0],w=words[language]||words.en;
 document.documentElement.lang=words[language]?language:'en';
 document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=w[el.dataset.i18n]);
 let token=location.hash.slice(1),blobUrl=null;
 history.replaceState(null,'',location.pathname+location.search);
 const file=document.querySelector('#file'),save=document.querySelector('#save'),status=document.querySelector('#status'),preview=document.querySelector('#preview');
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)){status.textContent=w.invalid;file.disabled=true;token=null}
 file.addEventListener('change',()=>{
  if(blobUrl)URL.revokeObjectURL(blobUrl);save.disabled=true;status.textContent='';
  const selected=file.files[0];if(!selected)return;
  if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>8*1024*1024){status.textContent=w.large;return}
  blobUrl=URL.createObjectURL(selected);preview.src=blobUrl;preview.hidden=false;document.querySelector('#placeholder').hidden=true;save.disabled=!token;
 });
 document.querySelector('#form').addEventListener('submit',async event=>{
  event.preventDefault();if(!token||!file.files[0]||save.disabled)return;save.disabled=true;file.disabled=true;status.textContent=w.saving;
  try{
   const imageBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file.files[0])});
   const response=await fetch('/api/avatar-upload',{method:'PUT',headers:{Authorization:'Avatar '+token,'Content-Type':'application/json','Accept-Language':language},body:JSON.stringify({imageBase64}),signal:AbortSignal.timeout(30000)});
   const body=await response.json();if(!response.ok){if(response.status===403)token=null;throw Error(body.error||w.offline)}
   token=null;status.textContent=w.success;
  }catch(error){status.textContent=error.name==='TypeError'||error.name==='TimeoutError'?w.offline:error.message;file.disabled=!token;save.disabled=!token}
 });
})();
