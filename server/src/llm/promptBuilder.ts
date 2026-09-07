import { Category, LLMPrompt, StoryFigureEntry, StoryLength } from '../types';

const CATEGORY_LABELS: Record<Category, string> = {
  character: 'דמויות',
  location: 'מקומות',
  mood: 'מצבי רוח',
  object: 'חפצים',
};

const LENGTH_WORD_COUNTS: Record<StoryLength, string> = {
  short: 'כ-200-300 מילים',
  medium: 'כ-500-700 מילים',
  long: 'כ-900-1200 מילים',
};

// Hebrew costs roughly 4-6 tokens a word across these models, so the old flat 2000 ceiling cut
// medium stories off mid-sentence at about 350 words. Sized off the top of each range with room
// to spare - the length is steered by the prompt, and this only stops a story being truncated.
const LENGTH_MAX_TOKENS: Record<StoryLength, number> = {
  short: 2500,
  medium: 5000,
  long: 8000,
};

function buildSystemPrompt(length: StoryLength): string {
  return `אתה מספר סיפורים לילדים לפני השינה, וכותב בעברית פשוטה, חמה ומדויקת לגילאי 3-8.

מבנה - חובה:
- כבר בפסקה הראשונה יש לדמות רצון אחד ברור: משהו שהיא רוצה או צריכה עכשיו.
- משהו עומד בדרך, והדמויות מנסות ונכשלות לפחות פעם אחת. הניסיון שנכשל הוא לב הסיפור, לא משפט אחד בדרך.
- הפתרון מגיע ממשהו שהדמויות עושות, מבינות או מוותרות עליו בעצמן. אם יש חפץ קסום, הוא עוזר רק בזכות בחירה נכונה שלהן, ולא פותר את הסיפור לבדו.
- הסוף רגוע ומכין לשינה: תמונה שקטה אחת. בלי סיכום ובלי מוסר השכל. אסור לכתוב משפטים כמו "וכך הם למדו ש...", "יחד הכל אפשרי" או "מאז ידעו ש...".
- האיסור על מוסר השכל חל גם על דיאלוג: אסור שדמות תסכם בקול את הלקח או תנקוב בשם מצב הרוח, למשל "הצלחנו בזכות התמדה!" או "העיקר לא לוותר". הדמויות מדברות על מה שקורה עכשיו, לא על מה שלמדו.

דמויות:
- לכל דמות תכונה אחת מובחנת שמשפיעה על מה שקורה - לא רק שם ותיאור.
- שלב דיאלוג: לפחות ארבע שורות דיבור קצרות לאורך הסיפור.
- אחרי ההזכרה הראשונה קרא לדמות בשם קצר, ואל תחזור שוב ושוב על התיאור המלא שלה.
- קבע לכל דמות מין דקדוקי אחד (זכר או נקבה) לפני שאתה כותב, והשתמש בו בעקביות מוחלטת בכל פועל, שם תואר וכינוי לאורך כל הסיפור, כולל בדיאלוג שהדמות עצמה אומרת על עצמה. דמות שמדברת על עצמה "אני יכולה" לא יכולה להיות מתוארת "הוא לוחש" באותו סיפור.

מצב הרוח שסופק הוא הרגש שהסיפור עובר דרכו: הראה אותו במעשים ובדיאלוג. אל תכתוב את שמו כמשפט בסיפור.

שפה:
- משפטים קצרים ומילים פשוטות, אבל פרטים קונקרטיים וחושיים - מה שומעים, מה מריחים, מה מרגישים בידיים - במקום תיאורים כלליים כמו "מקום קסום" או "נוף מדהים".
- אל תפתח ב"יום אחד", "לפני זמן רב" או "היה היה". פתח בתוך רגע שכבר קורה.
- בטוח, חיובי, בלי פחד אמיתי ובלי אלימות. מותר קושי, אכזבה ומבוכה - הם מה שהופך סיפור למעניין.

אורך הסיפור: ${LENGTH_WORD_COUNTS[length]}. הקפד על האורך הזה; סיפור קצר בהרבה מזה נחשב תשובה שגויה.
השתמש בכל הדמויות, המקומות ומצבי הרוח שסופקו, ושלב גם חפצים אם ניתנו. לא כל דמות חייבת להופיע בכל סצנה.
השורה הראשונה בתשובה היא כותרת קצרה ומושכת לסיפור (2-5 מילים, ללא גרשיים, ללא נקודה בסוף).
אחרי הכותרת השאר שורה ריקה אחת, ולאחר מכן כתוב את גוף הסיפור כפסקאות רגילות.
אל תשתמש בתגי Markdown (כמו #, *, -) ואל תוסיף הערות או הסברים נוספים מעבר לכותרת ולגוף הסיפור.`;
}

function groupByCategory(figures: StoryFigureEntry[]): Partial<Record<Category, string[]>> {
  const groups: Partial<Record<Category, string[]>> = {};
  for (const figure of figures) {
    if (!groups[figure.category]) groups[figure.category] = [];
    groups[figure.category]!.push(figure.name);
  }
  return groups;
}

export function buildPrompt(
  figures: StoryFigureEntry[],
  recentHistory: string[] = [],
  length: StoryLength = 'medium'
): LLMPrompt {
  const groups = groupByCategory(figures);
  const lines: string[] = [];

  for (const category of Object.keys(CATEGORY_LABELS) as Category[]) {
    const names = groups[category];
    if (names && names.length > 0) {
      lines.push(`${CATEGORY_LABELS[category]}: ${names.join(', ')}`);
    }
  }

  let userContent = `בנה סיפור לילדים לפי הרכיבים הבאים:\n${lines.join('\n')}`;

  if (recentHistory.length > 0) {
    const openings = recentHistory
      .map((text, i) => `${i + 1}. ${text.slice(0, 150).trim()}...`)
      .join('\n');
    // showing only the openings taught it to vary the first line while keeping the same plot,
    // so spell out that the shape of the story is what has to differ
    userContent +=
      `\n\nלהלן תחילת סיפורים אחרונים שכבר סופרו. אל תחזור על הפתיח שלהם, ובעיקר אל תחזור על מבנה העלילה שלהם:` +
      `\n${openings}` +
      `\n\nאם הסיפורים האלה הם מסע אל מקום, כתוב הפעם סיפור שקורה כולו במקום אחד. אם משהו אבד בהם, אל תאבד דבר הפעם. שנה את סוג הבעיה, לא רק את המילים.`;
  }

  return { system: buildSystemPrompt(length), user: userContent, maxTokens: LENGTH_MAX_TOKENS[length] };
}

export { CATEGORY_LABELS };
