const BASE = "app85fHkF9Jr8eXvF";
const T = { classes:"Classes", subjects:"Subjects", students:"Students", grades:"Grades", users:"Users", logs:"ActivityLogs", exams:"Exams", teachers:"Teachers" };
const COOKIE = "nomreyar_session";
const enc = s => new TextEncoder().encode(s);
const json = (data, status=200, headers={}) => new Response(JSON.stringify(data), { status, headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff", ...headers } });
const bad = (message, status=400) => json({ error:message }, status);
const fields = r => r?.fields || {};
const choice = v => typeof v === "string" ? v : (v?.name || "");
const clean = v => String(v ?? "").trim();
const norm = v => clean(v).normalize("NFKC").replace(/[ي]/g,"ی").replace(/[ك]/g,"ک").replace(/\s+/g," ").toLowerCase();
const normClass = v => norm(v).replace(/^هشتم\s+/,"");
const allowedAssessment = ["مستمر","آزمون کتبی","آزمون شفاهی","فعالیت کلاسی","پروژه","امتحان پایانی"];
const allowedBranches = ["زیست‌شناسی","فیزیک","شیمی","زمین‌شناسی"];
const signingKey = env => env.SESSION_SECRET || env.ADMIN_PASSWORD;
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", enc(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc(value)));
}
async function session(user, env) {
  const payload = b64(enc(JSON.stringify({...user, exp:Date.now()+8*60*60*1000})));
  return payload + "." + await sign(payload, signingKey(env));
}
async function current(request, env) {
  const match = (request.headers.get("cookie") || "").match(/(?:^|;\s*)nomreyar_session=([^;]+)/);
  if (!match) return null;
  const [payload, signature] = match[1].split(".");
  if (!payload || !signature || signature !== await sign(payload, signingKey(env))) return null;
  try {
    const user = JSON.parse(new TextDecoder().decode(unb64(payload)));
    return user.exp > Date.now() && ["admin","teacher"].includes(user.role) ? user : null;
  } catch { return null; }
}
async function airtable(env, table, method="GET", body=null, query="") {
  if (!env.AIRTABLE_TOKEN) throw new Error("اتصال Airtable تنظیم نشده است؛ مقدار AIRTABLE_TOKEN را بررسی کنید.");
  const url = "https://api.airtable.com/v0/" + BASE + "/" + encodeURIComponent(table) + query;
  let response, data;
  for (let attempt=0; attempt<3; attempt++) {
    response = await fetch(url, { method, headers:{Authorization:"Bearer "+env.AIRTABLE_TOKEN,"Content-Type":"application/json"}, body:body ? JSON.stringify(body) : undefined });
    data = await response.json().catch(()=>({}));
    if (response.ok) return data;
    if (![429,500,502,503,504].includes(response.status) || attempt===2) {
      const detail = data?.error?.message || data?.error || "خطای ارتباط با Airtable";
      const error = new Error(typeof detail==="string" ? detail : "درخواست Airtable ناموفق بود.");
      error.status = response.status;
      throw error;
    }
    await new Promise(resolve=>setTimeout(resolve, 250*(attempt+1)));
  }
  throw new Error("ارتباط با Airtable برقرار نشد.");
}
async function all(table, env) {
  const records=[]; let offset;
  do {
    const query = offset ? "?offset="+encodeURIComponent(offset) : "";
    const result = await airtable(env, table, "GET", null, query);
    records.push(...(result.records||[]));
    offset = result.offset;
    if (records.length >= 5000 && offset) throw new Error("تعداد رکوردهای این جدول از سقف امن دریافت بیشتر است.");
  } while(offset);
  return records;
}
async function log(env, user, action, type, id, before, after, reason="") {
  try {
    await airtable(env,T.logs,"POST",{records:[{fields:{
      Action:action,"Entity Type":type,"Entity ID":id||"",
      Before:before===undefined?"":JSON.stringify(before),
      After:after===undefined?"":JSON.stringify(after),
      "Actor Email":user.email,Timestamp:new Date().toISOString(),Reason:reason
    }}]});
  } catch {}
}
function cookie(value, maxAge) {
  return COOKIE+"="+value+"; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age="+maxAge;
}
async function requireAdmin(user) {
  return user?.role === "admin";
}
async function teacherAccess(user, env, className, subject) {
  if (user.role === "admin") return true;
  const teachers = await all(T.teachers,env);
  const record = teachers.find(r=>clean(fields(r).Email).toLowerCase()===user.email && fields(r).Active!==false);
  if (!record) return false;
  const classes = Array.isArray(fields(record)["Allowed Classes"]) ? fields(record)["Allowed Classes"].map(choice) : [];
  const subjects = clean(fields(record)["Allowed Subjects"]).split(/[،,]/).map(x=>x.trim()).filter(Boolean);
  return (!className || classes.includes(className)) && (!subject || subjects.includes(subject));
}
async function getClassNames(env) {
  const rows = await all(T.classes,env);
  return rows.filter(r=>fields(r).Active!==false).map(r=>clean(fields(r)["Class Name"])).filter(Boolean);
}
async function getSubjects(env) {
  const rows = await all(T.subjects,env);
  return rows.filter(r=>fields(r).Active===true && choice(fields(r).Category)!=="درس تکمیلی")
    .map(r=>({name:clean(fields(r)["Subject Name"]),category:choice(fields(r).Category),parentSubject:clean(fields(r)["Parent Subject"])}))
    .filter(x=>x.name);
}
async function findStudentByCode(env, code) {
  const rows = await all(T.students,env);
  return rows.find(r=>clean(fields(r)["Student Code"])===String(code) && fields(r).Active!==false);
}
async function updateMany(env, table, records) {
  for (let i=0;i<records.length;i+=10) await airtable(env,table,"PATCH",{records:records.slice(i,i+10)});
}
async function onRequest({request,env}) {
  try {
    if (!signingKey(env)) return bad("برای ورود امن، ADMIN_PASSWORD را در Cloudflare به‌صورت Secret تنظیم کنید.",503);
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/,"").replace(/\/$/,"");
    const method = request.method.toUpperCase();
    if (["POST","PATCH","PUT","DELETE"].includes(method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return bad("درخواست بین‌سایتی مجاز نیست.",403);
    }

    if (path==="login" && method==="POST") {
      let body; try { body=await request.json(); } catch { return bad("اطلاعات ورود معتبر نیست."); }
      const email=clean(body.email).toLowerCase(), password=String(body.password??"");
      if (!email || !password) return bad("ایمیل و رمز عبور لازم است.");
      let user;
      const adminEmail=clean(env.ADMIN_EMAIL||"deldarisepehr@gmail.com").toLowerCase();
      if (email===adminEmail) {
        if (!env.ADMIN_PASSWORD || password!==String(env.ADMIN_PASSWORD)) return bad("ایمیل یا رمز عبور اشتباه است.",401);
        user={email,role:"admin",name:"مدیر سامانه"};
      } else {
        const users=await all(T.users,env);
        const record=users.find(r=>clean(fields(r).Email).toLowerCase()===email);
        if (!record) return bad("حسابی با این ایمیل پیدا نشد.",401);
        const data=fields(record);
        if (data.Active===false) return bad("این حساب غیرفعال است.",403);
        if (!data["Password Hash"] || !await verifyPassword(password,data["Password Hash"])) return bad("ایمیل یا رمز عبور اشتباه است.",401);
        const role=choice(data.Role);
        if (role!=="معلم" && role!=="مدیر") return bad("نقش این حساب در Airtable معتبر نیست.",403);
        if (role==="معلم") {
          const teachers=await all(T.teachers,env);
          const teacher=teachers.find(r=>clean(fields(r).Email).toLowerCase()===email && fields(r).Active!==false);
          if (!teacher) return bad("دسترسی این حساب معلم فعال نیست.",403);
        }
        user={email,role:role==="مدیر"?"admin":"teacher",name:data["Display Name"]||email};
      }
      const token=await session(user,env);
      return json({user},200,{"Set-Cookie":cookie(token,28800)});
    }
    if (path==="logout" && method==="POST") return json({ok:true},200,{"Set-Cookie":cookie("",0)});
    const user=await current(request,env);
    if (!user) return bad("نشست ورود معتبر نیست؛ دوباره وارد شوید.",401);
    if (path==="me" && method==="GET") return json({user});

    if (path==="classes" && method==="GET") {
      const names=await getClassNames(env);
      if (user.role==="teacher") {
        const teachers=await all(T.teachers,env);
        const teacher=teachers.find(r=>clean(fields(r).Email).toLowerCase()===user.email && fields(r).Active!==false);
        const allowed=Array.isArray(fields(teacher||{})["Allowed Classes"])?fields(teacher||{})["Allowed Classes"].map(choice):[];
        return json({items:names.filter(n=>allowed.includes(n)).map(name=>({name}))});
      }
      return json({items:names.map(name=>({name}))});
    }
    if (path==="subjects" && method==="GET") {
      const subjects=await getSubjects(env);
      if (user.role==="teacher") {
        const teachers=await all(T.teachers,env);
        const teacher=teachers.find(r=>clean(fields(r).Email).toLowerCase()===user.email && fields(r).Active!==false);
        const allowed=clean(fields(teacher||{})["Allowed Subjects"]).split(/[،,]/).map(x=>x.trim()).filter(Boolean);
        return json({items:subjects.filter(s=>allowed.includes(s.name))});
      }
      return json({items:subjects});
    }

    if (path==="students" && method==="GET") {
      const rows=await all(T.students,env);
      const visible=[];
      for (const r of rows) {
        const x=fields(r), cl=clean(x["Class Name"]);
        if (x.Active===false) continue;
        if (user.role==="teacher" && !await teacherAccess(user,env,cl,null)) continue;
        visible.push({id:r.id,code:clean(x["Student Code"]),name:[x["First Name"],x["Last Name"]].filter(Boolean).join(" "),firstName:x["First Name"]||"",lastName:x["Last Name"]||"",className:cl,active:true});
      }
      return json({items:visible});
    }
    if (path==="students" && method==="POST") {
      if (user.role!=="admin") return bad("فقط مدیر مجاز به افزودن دانش‌آموز است.",403);
      let b; try { b=await request.json(); } catch { return bad("اطلاعات دانش‌آموز معتبر نیست."); }
      const first=clean(b.firstName).replace(/\s+/g," "), last=clean(b.lastName).replace(/\s+/g," "), cl=clean(b.className);
      const classes=await getClassNames(env);
      if (!first||!last||first.length>60||last.length>60||!classes.includes(cl)) return bad("نام، نام خانوادگی و کلاس معتبر الزامی است.");
      const roster=await all(T.students,env);
      if (roster.some(r=>norm(fields(r)["First Name"])===norm(first)&&norm(fields(r)["Last Name"])===norm(last)&&normClass(fields(r)["Class Name"])===normClass(cl)&&fields(r).Active!==false)) return bad("دانش‌آموزی با همین نام در این کلاس وجود دارد.",409);
      const used=new Set(roster.map(r=>clean(fields(r)["Student Code"])));
      let code="";
      for(let i=0;i<1000;i++){const n=new Uint32Array(1);crypto.getRandomValues(n);const candidate=String(10000+(n[0]%90000));if(!used.has(candidate)){code=candidate;break;}}
      if(!code) return bad("ساخت کد پنج‌رقمی یکتا ممکن نشد؛ دوباره تلاش کنید.",503);
      const result=await airtable(env,T.students,"POST",{records:[{fields:{"Student Code":code,"First Name":first,"Last Name":last,"Class Name":cl,Active:true,"Created At":new Date().toISOString()}}]});
      await log(env,user,"CREATE","Student",result.records?.[0]?.id,undefined,{first,last,className:cl,code});
      return json({ok:true,studentCode:code},201);
    }
    const studentRoute=path.match(/^students\/(rec[A-Za-z0-9]{14})$/);
    if (studentRoute && ["PATCH","DELETE"].includes(method)) {
      if (user.role!=="admin") return bad("فقط مدیر مجاز به ویرایش یا حذف دانش‌آموز است.",403);
      const id=studentRoute[1],rows=await all(T.students,env),record=rows.find(r=>r.id===id);
      if (!record || fields(record).Active===false) return bad("دانش‌آموز پیدا نشد.",404);
      const old=fields(record);
      if (method==="DELETE") {
        await airtable(env,T.students,"PATCH",{records:[{id,fields:{Active:false}}]});
        await log(env,user,"DEACTIVATE","Student",id,old,{Active:false},"حذف نرم؛ سوابق نمره حفظ شدند.");
        return json({ok:true,message:"دانش‌آموز غیرفعال شد؛ سوابق نمرات حفظ شده‌اند."});
      }
      let b; try { b=await request.json(); } catch { return bad("اطلاعات ویرایش معتبر نیست."); }
      const first=clean(b.firstName).replace(/\s+/g," "),last=clean(b.lastName).replace(/\s+/g," "),cl=clean(b.className);
      const classes=await getClassNames(env);
      if(!first||!last||first.length>60||last.length>60||!classes.includes(cl)) return bad("نام، نام خانوادگی و کلاس معتبر الزامی است.");
      if(rows.some(r=>r.id!==id&&fields(r).Active!==false&&norm(fields(r)["First Name"])===norm(first)&&norm(fields(r)["Last Name"])===norm(last)&&normClass(fields(r)["Class Name"])===normClass(cl))) return bad("دانش‌آموز دیگری با همین نام در این کلاس وجود دارد.",409);
      await airtable(env,T.students,"PATCH",{records:[{id,fields:{"First Name":first,"Last Name":last,"Class Name":cl}}]});
      const gradeRows=await all(T.grades,env);
      const linked=gradeRows.filter(r=>clean(fields(r)["Student Code"])===clean(old["Student Code"]));
      const updates=linked.map(r=>({id:r.id,fields:{"Student Name":first+" "+last,"Class Name":cl}}));
      if(updates.length) await updateMany(env,T.grades,updates);
      await log(env,user,"UPDATE","Student",id,old,{first,last,className:cl});
      return json({ok:true,message:"اطلاعات دانش‌آموز و مشخصات او در سوابق نمره به‌روزرسانی شد."});
    }

    if (path==="grades" && method==="GET") {
      const rows=await all(T.grades,env),items=[];
      for(const r of rows){
        const x=fields(r),cl=clean(x["Class Name"]),subject=clean(x.Subject);
        if(!["معتبر","اصلاح‌شده"].includes(choice(x.Status))) continue;
        if(user.role==="teacher" && !await teacherAccess(user,env,cl,subject)) continue;
        items.push({id:r.id,studentCode:clean(x["Student Code"]),studentName:clean(x["Student Name"]),className:cl,subject,scienceBranch:choice(x["Science Branch"]),assessmentType:choice(x["Assessment Type"]),score:x.Score,coefficient:Number(x.Coefficient)||1,examName:clean(x["Exam Name"]),examDate:x["Exam Date"]||"",recordedBy:clean(x["Recorded By"]),status:choice(x.Status)});
      }
      return json({items});
    }
    if (path==="grades" && method==="POST") {
      let b; try { b=await request.json(); } catch { return bad("اطلاعات نمره معتبر نیست."); }
      const code=clean(b.studentCode),cl=clean(b.className),subject=clean(b.subject),score=Number(b.score),coefficient=Number(b.coefficient??1),examName=clean(b.examName),assessment=clean(b.assessmentType||"آزمون کتبی"),branch=clean(b.scienceBranch);
      if(!Number.isFinite(score)||score<0||score>20||!Number.isFinite(coefficient)||coefficient<=0||coefficient>100||!examName||examName.length>120||!allowedAssessment.includes(assessment)) return bad("نمره باید بین ۰ تا ۲۰ و ضریب بین ۰ تا ۱۰۰ باشد؛ نام آزمون و نوع ارزیابی هم الزامی است.");
      if(!await teacherAccess(user,env,cl,subject)) return bad("برای این کلاس یا درس مجوز ثبت نمره ندارید.",403);
      const classes=await getClassNames(env),subjects=await getSubjects(env);
      if(!classes.includes(cl)||!subjects.some(s=>s.name===subject)) return bad("کلاس یا درس انتخاب‌شده معتبر نیست.");
      if(subject==="علوم تجربی" && !allowedBranches.includes(branch)) return bad("برای درس علوم تجربی باید یکی از شاخه‌های علوم را انتخاب کنید.");
      const student=await findStudentByCode(env,code);
      const studentName=student?[fields(student)["First Name"],fields(student)["Last Name"]].filter(Boolean).join(" "):"";
      if(!student||clean(fields(student)["Class Name"])!==cl) return bad("دانش‌آموز با این کد در کلاس انتخاب‌شده وجود ندارد.",400);
      const date=clean(b.examDate);
      if(date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("تاریخ آزمون معتبر نیست.");
      const result=await airtable(env,T.grades,"POST",{records:[{fields:{
        "Grade ID":"G"+crypto.randomUUID(),"Student Code":code,"Student Name":studentName,"Class Name":cl,
        Subject:subject,"Science Branch":subject==="علوم تجربی"?branch:null,"Assessment Type":assessment,
        Score:score,Coefficient:coefficient,"Exam Name":examName,"Exam Date":date||new Date().toISOString().slice(0,10),
        "Recorded At":new Date().toISOString(),"Recorded By":user.email,Status:"معتبر"
      }}]});
      await log(env,user,"CREATE","Grade",result.records?.[0]?.id,undefined,{studentName,className:cl,subject,score,coefficient});
      return json({ok:true,id:result.records?.[0]?.id},201);
    }
    const gradeRoute=path.match(/^grades\/(rec[A-Za-z0-9]{14})$/);
    if(gradeRoute && ["PATCH","DELETE"].includes(method)){
      const id=gradeRoute[1],rows=await all(T.grades,env),record=rows.find(r=>r.id===id);
      if(!record||!["معتبر","اصلاح‌شده"].includes(choice(fields(record).Status))) return bad("نمره پیدا نشد.",404);
      const old=fields(record),cl=clean(old["Class Name"]),subject=clean(old.Subject);
      if(method==="DELETE"){
        if(user.role!=="admin") return bad("فقط مدیر مجاز به حذف نمره است.",403);
        await airtable(env,T.grades,"PATCH",{records:[{id,fields:{Status:"باطل‌شده"}}]});
        await log(env,user,"VOID","Grade",id,old,{Status:"باطل‌شده"},"حذف نرم؛ سابقه حفظ شد.");
        return json({ok:true,message:"نمره باطل شد و از میانگین‌ها و گزارش‌های فعال کنار گذاشته شد."});
      }
      if(!await teacherAccess(user,env,cl,subject)) return bad("برای ویرایش این نمره مجوز ندارید.",403);
      if(user.role==="teacher" && clean(old["Recorded By"]).toLowerCase()!==user.email) return bad("معلم فقط می‌تواند نمره‌ای را ویرایش کند که خودش ثبت کرده است.",403);
      let b; try{b=await request.json();}catch{return bad("اطلاعات ویرایش نمره معتبر نیست.");}
      const score=Number(b.score),coefficient=Number(b.coefficient??old.Coefficient??1),examName=clean(b.examName??old["Exam Name"]),assessment=clean(b.assessmentType||choice(old["Assessment Type"])||"آزمون کتبی"),branch=clean(b.scienceBranch??choice(old["Science Branch"]));
      if(!Number.isFinite(score)||score<0||score>20||!Number.isFinite(coefficient)||coefficient<=0||coefficient>100||!examName||!allowedAssessment.includes(assessment)) return bad("مقادیر نمره، ضریب، نام آزمون یا نوع ارزیابی معتبر نیست.");
      if(subject==="علوم تجربی"&&!allowedBranches.includes(branch)) return bad("شاخه علوم معتبر انتخاب نشده است.");
      const date=clean(b.examDate??old["Exam Date"]);
      if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("تاریخ آزمون معتبر نیست.");
      const updated={"Score":score,"Coefficient":coefficient,"Exam Name":examName,"Assessment Type":assessment,"Science Branch":subject==="علوم تجربی"?branch:null,"Exam Date":date||null,Status:"اصلاح‌شده"};
      await airtable(env,T.grades,"PATCH",{records:[{id,fields:updated}]});
      await log(env,user,"UPDATE","Grade",id,old,updated);
      return json({ok:true,message:"نمره ویرایش شد."});
    }

    if(path==="grades/reset" && method==="POST"){
      if(user.role!=="admin") return bad("فقط مدیر مجاز به ریست نمرات است.",403);
      let b; try{b=await request.json();}catch{return bad("درخواست ریست معتبر نیست.");}
      if(String(b.password??"")!==String(env.ADMIN_PASSWORD??"")) return bad("رمز مدیر صحیح نیست.",401);
      if(b.confirmText!=="باطل کردن") return bad("تأیید نهایی انجام نشده است.");
      const ids=Array.isArray(b.ids)?[...new Set(b.ids.filter(x=>typeof x==="string"&&/^rec[A-Za-z0-9]{14}$/.test(x)))]:[];
      if(!ids.length||ids.length>500) return bad("باید بین ۱ تا ۵۰۰ نمره برای ریست انتخاب کنید.");
      const rows=await all(T.grades,env),selected=rows.filter(r=>ids.includes(r.id)&&["معتبر","اصلاح‌شده"].includes(choice(fields(r).Status)));
      if(selected.length!==ids.length) return bad("بعضی از نمرات انتخاب‌شده پیدا نشدند یا قبلاً باطل شده‌اند؛ فهرست را تازه‌سازی کنید.",409);
      await updateMany(env,T.grades,selected.map(r=>({id:r.id,fields:{Status:"باطل‌شده"}})));
      await log(env,user,"BULK_VOID","Grade",ids.join(","),undefined,{count:ids.length},"ریست انتخابی باطل‌سازی نرم.");
      return json({ok:true,count:ids.length,message:ids.length+" نمره باطل شد؛ اطلاعات دانش‌آموزان و سوابق حفظ شدند."});
    }

    if(path==="exams" && method==="GET"){
      const rows=await all(T.exams,env),items=[];
      for(const r of rows){const x=fields(r),cl=clean(x["Class Name"]),subject=clean(x.Subject);if(user.role==="teacher"&&!await teacherAccess(user,env,cl,subject))continue;items.push({id:r.id,name:clean(x["Exam Name"]),className:cl,subject,scienceBranch:clean(x["Science Branch"]),assessmentType:clean(x["Assessment Type"]),examDate:x["Exam Date"]||"",coefficient:Number(x.Coefficient)||1,description:clean(x.Description)});}
      return json({items});
    }
    if(path==="exams" && method==="POST"){
      if(user.role!=="admin") return bad("فقط مدیر مجاز به تعریف آزمون است.",403);
      let b;try{b=await request.json();}catch{return bad("اطلاعات آزمون معتبر نیست.");}
      const name=clean(b.name),cl=clean(b.className),subject=clean(b.subject),coef=Number(b.coefficient??1),assessment=clean(b.assessmentType||"آزمون کتبی"),branch=clean(b.scienceBranch);
      if(!name||name.length>120||!Number.isFinite(coef)||coef<=0||coef>100||!allowedAssessment.includes(assessment))return bad("نام آزمون، ضریب یا نوع ارزیابی معتبر نیست.");
      if(!(await getClassNames(env)).includes(cl)||!(await getSubjects(env)).some(s=>s.name===subject))return bad("کلاس یا درس معتبر نیست.");
      if(subject==="علوم تجربی"&&!allowedBranches.includes(branch))return bad("برای علوم تجربی باید شاخه علوم مشخص شود.");
      const date=clean(b.examDate);if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return bad("تاریخ آزمون معتبر نیست.");
      const result=await airtable(env,T.exams,"POST",{records:[{fields:{"Exam Name":name,"Class Name":cl,Subject:subject,"Science Branch":subject==="علوم تجربی"?branch:"","Assessment Type":assessment,"Exam Date":date||new Date().toISOString().slice(0,10),Coefficient:coef,Description:clean(b.description)}}]});
      await log(env,user,"CREATE","Exam",result.records?.[0]?.id,undefined,{name,className:cl,subject});
      return json({ok:true},201);
    }
    if(path==="teachers" && method==="GET"){
      if(user.role!=="admin")return bad("دسترسی مدیر لازم است.",403);
      const rows=await all(T.teachers,env);
      return json({items:rows.map(r=>({id:r.id,name:clean(fields(r)["Teacher Name"]),email:clean(fields(r).Email),classes:Array.isArray(fields(r)["Allowed Classes"])?fields(r)["Allowed Classes"].map(choice):[],subjects:clean(fields(r)["Allowed Subjects"]).split(/[،,]/).map(x=>x.trim()).filter(Boolean),active:fields(r).Active!==false}))});
    }
    if(path==="teachers" && method==="POST"){
      if(user.role!=="admin")return bad("فقط مدیر مجاز به ایجاد حساب معلم است.",403);
      let b;try{b=await request.json();}catch{return bad("اطلاعات معلم معتبر نیست.");}
      const name=clean(b.name),email=clean(b.email).toLowerCase(),password=String(b.password??""),classes=Array.isArray(b.classes)?b.classes:[],subjects=Array.isArray(b.subjects)?b.subjects:[];
      if(!name||name.length>80||!/^[-.\w+]+@[-.\w]+\.[A-Za-z]{2,}$/.test(email)||password.length<8||!classes.length||!subjects.length)return bad("نام، ایمیل معتبر، رمز حداقل ۸ کاراکتری، کلاس و درس مجاز الزامی است.");
      const classNames=await getClassNames(env),subjectNames=(await getSubjects(env)).map(x=>x.name);
      if(classes.some(x=>!classNames.includes(x))||subjects.some(x=>!subjectNames.includes(x)))return bad("کلاس یا درس انتخاب‌شده برای معلم معتبر نیست.");
      const users=await all(T.users,env);
      if(users.some(r=>clean(fields(r).Email).toLowerCase()===email))return bad("برای این ایمیل قبلاً حساب ساخته شده است.",409);
      const teachers=await all(T.teachers,env);
      if(teachers.some(r=>clean(fields(r).Email).toLowerCase()===email))return bad("این معلم قبلاً ثبت شده است.",409);
      const hash=await hashPassword(password);
      const createdUser=await airtable(env,T.users,"POST",{records:[{fields:{Email:email,"Display Name":name,Role:"معلم","Password Hash":hash,"Must Change Password":false,Active:true}}]});
      try{
        const createdTeacher=await airtable(env,T.teachers,"POST",{records:[{fields:{"Teacher Name":name,Email:email,"Allowed Classes":classes,"Allowed Subjects":subjects.join("، "),Active:true}}]});
        await log(env,user,"CREATE","Teacher",createdTeacher.records?.[0]?.id,undefined,{name,email,classes,subjects});
      }catch(error){
        const userId=createdUser.records?.[0]?.id;
        if(userId)try{await airtable(env,T.users,"DELETE",null,"/"+userId);}catch{}
        throw error;
      }
      return json({ok:true},201);
    }

    return bad("مسیر موردنظر پیدا نشد.",404);
  } catch(error) {
    const status=error.status===429?503:(error.status>=400&&error.status<500?error.status:500);
    return bad(status===503?"سرویس Airtable موقتاً محدود شده است؛ چند لحظه بعد دوباره تلاش کنید.":(error.message||"خطای داخلی سرور"),status);
  }
}
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",enc(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256);
  return b64(salt)+"$"+b64(bits);
}
async function verifyPassword(password,stored){
  try{
    const [salt,hash]=stored.split("$");
    const key=await crypto.subtle.importKey("raw",enc(password),"PBKDF2",false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:unb64(salt),iterations:210000,hash:"SHA-256"},key,256);
    return b64(bits)===hash;
  }catch{return false;}
}