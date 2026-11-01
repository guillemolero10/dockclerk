import type { Dict, Lang } from "./core";
import * as common from "./dict/common";
import * as operator from "./dict/operator";
import * as breakdown from "./dict/breakdown";
import * as driver from "./dict/driver";
import * as receipt from "./dict/receipt";
import * as login from "./dict/login";
import * as portal from "./dict/portal";
import * as office from "./dict/office";
import * as inbox from "./dict/inbox";
import * as dock from "./dict/dock";
import * as warehouse from "./dict/warehouse";
import * as alerts from "./dict/alerts";
import * as trace from "./dict/trace";
import * as billing from "./dict/billing";
import * as analyst from "./dict/analyst";

// One file per area in ./dict, each with its English and Spanish side by side. The Spanish side is typed
// `Record<keyof en, string>`, so a missing translation fails `tsc`.
const zones = [common, operator, breakdown, driver, receipt, login, portal, office, inbox, dock, warehouse, alerts, trace, billing, analyst];

const build = (lang: Lang): Dict => Object.assign({}, ...zones.map((zone) => zone[lang]));

const cache: Partial<Record<Lang, Dict>> = {};
export const dictionary = (lang: Lang): Dict => (cache[lang] ??= build(lang));

/** Every translation key. `t("…")` only accepts these. */
export type Key = keyof typeof common.en | keyof typeof operator.en | keyof typeof breakdown.en
  | keyof typeof driver.en
  | keyof typeof receipt.en
  | keyof typeof login.en
  | keyof typeof portal.en
  | keyof typeof office.en
  | keyof typeof inbox.en
  | keyof typeof dock.en
  | keyof typeof warehouse.en
  | keyof typeof alerts.en
  | keyof typeof trace.en
  | keyof typeof billing.en
  | keyof typeof analyst.en;
