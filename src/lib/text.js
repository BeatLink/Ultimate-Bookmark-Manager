// Alphabetical comparison that ignores case and accents and orders numbers by value ("item2" before "item10").
export const byText = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare;
