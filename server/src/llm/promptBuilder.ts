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

function buildSystemPrompt(length: StoryLength): string {
  return `אתה מספר סיפורים לילדים לפני השינה.
אתה כותב בעברית פשוטה, חמה ומתאימה לגילאי 3-8.
הסיפור צריך להיות בטוח, חיובי ולא מפחיד, עם עלילה ברורה קצרה ועם סוף טוב ורגוע שמכין לשינה.
אורך הסיפור: ${LENGTH_WORD_COUNTS[length]}.
השתמש בכל הדמויות, המקומות ומצבי הרוח שסופקו, ושלב בעדינות גם חפצים אם ניתנו.
השורה הראשונה בתשובה צריכה להיות כותרת קצרה ומושכת לסיפור (2-5 מילים, ללא גרשיים, ללא נקודה בסוף).
אחרי הכותרת השאירו שורה ריקה אחת, ולאחר מכן כתבו את גוף הסיפור כפסקאות רגילות.
אל תשתמשו בתגי Markdown (כמו #, *, -) ואל תוסיפו הערות או הסברים נוספים מעבר לכותרת ולגוף הסיפור.`;
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
    userContent += `\n\nלהלן תחילת סיפורים אחרונים שכבר סופרו - נסה ליצור עלילה שונה מהם ולא לחזור על אותו פתיח או תפנית:\n${openings}`;
  }

  return { system: buildSystemPrompt(length), user: userContent };
}

export { CATEGORY_LABELS };
