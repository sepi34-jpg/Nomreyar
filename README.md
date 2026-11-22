# نمره‌یار | سامانه مدیریت نمرات پایه هشتم

سامانه فارسی و راست‌چین مدیریت نمرات چهار کلاس پایه هشتم مدرسه متوسطه اول خیام:
- خیام
- فردوسی
- حافظ
- مولانا

## فناوری
- رابط کاربری: HTML/CSS/JavaScript
- میزبانی و API امن: Cloudflare Pages Functions
- پایگاه داده: Airtable
- مخزن: GitHub

## راه‌اندازی Cloudflare Pages
1. در Cloudflare وارد Workers & Pages و سپس Create → Pages → Connect to Git شوید.
2. مخزن sepi34-jpg/Nomreyar و شاخه main را انتخاب کنید.
3. Build command را خالی بگذارید و Build output directory را / قرار دهید.
4. در Settings → Variables and Secrets این مقادیر را اضافه کنید:
   - AIRTABLE_TOKEN (Secret): توکن Airtable با دسترسی خواندن و نوشتن رکوردهای Base.
   - SESSION_SECRET (Secret): مقدار تصادفی طولانی برای امضای نشست.
   - ADMIN_EMAIL: ایمیل مدیر اولیه.
   - ADMIN_PASSWORD (Secret): رمز اولیه قوی مدیر.
5. دوباره Deploy کنید.

## Airtable
Base ID: app85fHkF9Jr8eXvF

جدول‌های موردنیاز: Classes, Students, Subjects, Grades, Exams, Teachers, Users, ActivityLogs.
نام فیلدها باید دقیقاً مطابق ساختار Base باشد.

در جدول Classes چهار رکورد فعال با نام‌های خیام، فردوسی، حافظ و مولانا و در جدول Subjects درس‌های مصوب مدرسه را وارد کنید. شاخه‌های علوم را جداگانه تعریف کنید. هیچ دانش‌آموز یا نمره فرضی ایجاد نکنید.

## وضعیت نسخه آغازین
ورود مدیر، نمایش کلاس‌ها و درس‌ها، افزودن دانش‌آموز توسط مدیر، مشاهده نمرات و ثبت نمره توسط مدیر فعال است. مدیریت مستقل آزمون‌ها و پنل دسترسی معلمان در مرحله بعد تکمیل می‌شود.

## امنیت
توکن Airtable و رمزها را در فایل‌های مخزن قرار ندهید؛ فقط از Secrets کلادفلر استفاده کنید. از رمز نمونه یا قابل حدس استفاده نکنید.
