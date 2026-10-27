'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'member.html');
if (!fs.existsSync(file)) {
  console.error('لم أجد member.html. ضع هذا الملف بجانب member.html داخل مجلد مشروع LOMBRA ثم أعد التشغيل.');
  process.exit(1);
}
let html = fs.readFileSync(file, 'utf8');
let changed = false;
function replaceOnce(from, to, label) {
  if (html.includes(to)) return;
  if (!html.includes(from)) {
    console.error('توقفت لحماية الملف: لم أجد الجزء المتوقع (' + label + '). لم يتم حفظ أي تغيير.');
    process.exit(2);
  }
  html = html.replace(from, to);
  changed = true;
}
// اجعل رابط قائمة أعضاء Discord ظاهراً لكل عضو، مع إبقاء بقية الصلاحيات كما هي.
replaceOnce('<button data-page="members" data-permission="viewAllMembers"><i class="fa-brands fa-discord"></i> أعضاء Discord</button>', '<button data-page="members"><i class="fa-brands fa-discord"></i> أعضاء Discord</button>', 'رابط قائمة الأعضاء');
// حمّل القائمة عند فتح صفحتها.
replaceOnce("if(name==='banned')loadBanned();", "if(name==='banned')loadBanned();\n if(name==='members')loadMembers();", 'فتح صفحة الأعضاء');
// حدّث قائمة الأعضاء من زر التحديث الموجود أصلاً.
replaceOnce("loadBannedCount();\n toast('تم التحديث');", "loadBannedCount();\n if(document.getElementById('page-members')?.classList.contains('active'))loadMembers();\n toast('تم التحديث');", 'زر التحديث');
// أضف تنسيقاً محدوداً فقط لصورة Discord، ولا تغيّر التصميم الموجود.
if (!html.includes('.discord-mini-avatar')) {
  replaceOnce('</style>', '.discord-user-cell{display:flex;align-items:center;gap:9px;min-width:150px}.discord-mini-avatar{width:30px;height:30px;flex:0 0 30px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,82,107,.35);background:#211019}.discord-mini-fallback{width:30px;height:30px;flex:0 0 30px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(145deg,#8d142c,#ef2849);font-weight:900;color:#fff}</style>', 'تنسيق صورة Discord');
}
const marker = '// تحميل قائمة المقصيين وتفعيل أزرار (إرجاع / حذف)';
if (!html.includes('async function loadMembers()')) {
  if (!html.includes(marker)) {
    console.error('توقفت لحماية الملف: لم أجد مكان إضافة دالة قائمة الأعضاء. لم يتم حفظ أي تغيير.');
    process.exit(2);
  }
  const fn = `// تحميل قائمة أعضاء Discord النشطين لجميع الأعضاء المسجلين.\nasync function loadMembers(){\n const table=$('membersTable');\n if(!table)return;\n table.innerHTML=emptyRow(4,'جارٍ تحميل الأعضاء...');\n try{\n  const d=await api('/api/members');\n  const members=d.accounts||d.members||[];\n  table.innerHTML=members.length?members.map(u=>{\n   const discordName=u.discord_global_name||u.discord_username||u.username||'عضو';\n   const avatar=u.discord_avatar?\`<img class="discord-mini-avatar" src="\${esc(u.discord_avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=&quot;discord-mini-fallback&quot;>M</span>'>\`:\`<span class="discord-mini-fallback">\${esc(String(discordName).slice(0,1).toUpperCase())}</span>\`;\n   return \`<tr><td><div class="discord-user-cell">\${avatar}<span>\${esc(discordName)}</span></div></td><td>\${esc(u.display_name||u.username||'—')}</td><td><span class="badge badge-gold">\${esc(u.role||'MEMBER')}</span></td><td><code dir="ltr">\${esc(u.invitation_code||'—')}</code></td></tr>\`;\n  }).join(''):emptyRow(4,'لا يوجد أعضاء نشطون حالياً.');\n }catch(e){table.innerHTML=emptyRow(4,e.message||'تعذّر تحميل قائمة الأعضاء.');}\n}\n\n`;
  html = html.replace(marker, fn + marker);
  changed = true;
}
if (changed) {
  const backup = file + '.backup-before-member-list';
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, html, 'utf8');
  console.log('تم تعديل member.html مع الحفاظ على تصميمك وأيقوناتك الموجودة. نسخة احتياطية: member.html.backup-before-member-list');
} else {
  console.log('قائمة الأعضاء مضافة مسبقاً؛ لم أغيّر الملف.');
}
