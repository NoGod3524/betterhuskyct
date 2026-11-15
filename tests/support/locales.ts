// Loads every language before the tests run, as a reader who chose it would have: the app
// fetches the Chinese strings only on demand, and the tests compare against them directly.
import { loadLocale } from "../../src/lib/i18n.ts";

await loadLocale("zh-CN");
