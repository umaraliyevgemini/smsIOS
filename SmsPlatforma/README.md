# SMS Platforma

Android telefondagi SIM-karta orqali Excel yoki CSV ro'yxatidan shaxsiylashtirilgan SMS yuboradigan React Native ilova. Excel ma'lumotini o'qish uchun Android ichida Python moduli ishlatiladi.

## Imkoniyatlar

- `.xlsx` va `.csv` fayllardan ism, familiya va telefon raqamlarini import qiladi.
- `{{ism}}`, `{{familiya}}`, `{{fio}}` va `{{telefon}}` joy-tutgichlari bilan bitta SMS shabloni tuziladi.
- Xabarlar ketma-ket, belgilangan kechikish bilan telefon SIM-kartasi orqali yuboriladi.
- Yuborishdan oldin rozilik tasdiqlovi va yakuniy tasdiqlash oynasi mavjud.
- Noto'g'ri yoki takrorlangan raqamlarni ajratib ko'rsatadi, yuborishni to'xtatish mumkin.

## Excel formati

Birinchi qator ustun nomlaridan iborat bo'lishi kerak. Quyidagi nomlar aniqlanadi:

| Ma'lumot | Tavsiya etilgan ustun |
| --- | --- |
| Ism | `ism` |
| Familiya | `familiya` yoki `familya` |
| Telefon raqami | `telefon` |

Masalan:

| ism | familiya | telefon |
| --- | --- | --- |
| Ali | Valiyev | +998901234567 |
| Malika | Karimova | 90 765 43 21 |

Telefon raqamlari avtomatik normallashtiriladi. O'zbekiston raqami faqat 9 xonadan berilsa, unga `+998` qo'shiladi.

## Ishlatish

1. Ilovani Android telefonga o'rnating va `SMS yuborish` ruxsatini bering.
2. `Excel/CSV tanlash` tugmasi bilan ro'yxatni import qiling.
3. Xabar shablonini yozing, masalan: `Assalomu alaykum, {{ism}} {{familiya}}! Sizga eslatma bor.`
4. Xabarlar kechikishini tanlang va qabul qiluvchilarning roziligi tasdiqlovini belgilang.
5. `Yuborishni boshlash` tugmasini bosing va yakuniy oynada tasdiqlang.

Faqat oldindan SMS olishga rozilik bergan kontaktlarga xabar yuboring. SMS narxi va kunlik cheklovlar mobil operator tarifiga bog'liq.

## Tayyor APK

Debug APK quyidagi manzilda yaratiladi:

`android/app/build/outputs/apk/debug/app-debug.apk`

Telefoningizda APK o'rnatishga ruxsat berish talab qilinishi mumkin. Bu debug imzoli build; Play Store'ga chiqarishdan oldin alohida release signing sozlanadi.

## Server API

Server faqat ilova tarqatilishi va holatini boshqaradi: kontaktlar, Excel fayllari yoki yuborilgan SMS mazmuni API'ga yuborilmaydi.

| Endpoint | Vazifasi |
| --- | --- |
| `GET /health` | Server ishlayotganini tekshiradi. |
| `GET /api/v1/app` | Ilovaning versiyasi, SHA-256 nazorat yig'indisi va APK manzilini qaytaradi. |
| `GET /download/sms-platforma.apk` | Android APK faylini yuklab beradi. |

Production manzillar:

- API: `https://isfandior.duckdns.org/api/v1/app`
- APK: `https://isfandior.duckdns.org/download/sms-platforma.apk`

Lokal API'ni ishga tushirish uchun avval debug APK'ni `backend/public/sms-platforma.apk` nomi bilan joylashtiring, so'ng:

```powershell
npm run backend:start
```

API testlari:

```powershell
npm run backend:test
```

## Ishlab chiqish va build

Talablar: Node.js, JDK 17, Android SDK (API 36), Android NDK va CMake.

```powershell
npm install
npm start
```

Boshqa terminalda Android qurilma yoki emulator uchun:

```powershell
npm run android
```

Faqat APK yig'ish:

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Telefonga Metro serversiz o'rnatish uchun release APK yig'ish:

```powershell
cd android
.\gradlew.bat :app:assembleRelease
```

Natija: `android/app/build/outputs/apk/release/app-release.apk`

## Tekshiruvlar

```powershell
npx tsc --noEmit
npm test -- --runInBand
py -3.14 -m py_compile android\app\src\main\python\excel_parser.py
```
