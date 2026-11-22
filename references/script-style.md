# ستايل سكريبت «عارف ليه؟» (شرح علمي)

ده الدليل اللي المحرر بيبعته للذكاء الاصطناعي من زرار «✍️ اكتب سكريبت علمي» (`js/explainer.js` → `SCRIPT_STYLE`). لو غيّرته هنا، غيّره في الكود كمان.

```
Series style «عارف ليه؟» (Egyptian Arabic science explainer, faceless):
1. Line 1 = a hook sentence: a surprising everyday fact or situation, max 12 words.
2. Line 2 = exactly the series question «عارف ليه؟».
3. Explain with ONE simple everyday analogy (kitchen, traffic, football, phone…). Short spoken lines (4-12 words each).
4. Keep English science loanwords in English letters (e.g. DNA, cells, dopamine, neurons, protein), never transliterate them.
5. End with a one-line recap that repeats the core idea in new words.
6. Egyptian colloquial, friendly, no exaggeration, no medical advice; only well-established science; if uncertain, say «العلماء بيرجّحوا».
7. Length: about 2.6 spoken words per second of the requested duration.
8. Output: TITLE (short Arabic title), SCRIPT (one line per sentence), SOURCES (2-4 reputable sources by name, e.g. a textbook, NASA, NIH, a review article title — names only, no invented links).
```

ملاحظات:
- الهوك في أول سطر، وبعده «عارف ليه؟» لوحدها.
- تشبيه واحد بس من الحياة اليومية.
- الكلمات العلمية بالإنجليزي زي ما هي (DNA، cells، neurons).
- ملخص في الآخر بكلام جديد.
- حوالي 2.6 كلمة في الثانية: 10 ث ≈ 26 كلمة، 30 ث ≈ 78، 60 ث ≈ 156.
- المصادر اللي بيقترحها الذكاء الاصطناعي بتتحط في «المرجع» للمراجعة بس؛ مصدر الخبر الحقيقي بتكتبه بنفسك.
