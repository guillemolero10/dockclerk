import { makeTranslate, type Translate } from "./core";
import { dictionary } from "./dictionaries";

/** English `t`: the default of pure helpers when the caller does not pass one (check scripts, tests). */
export const tEn: Translate = makeTranslate(dictionary("en"));
