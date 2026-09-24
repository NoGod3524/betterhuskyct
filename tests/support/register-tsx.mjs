// Installs tsx-loader.mjs for the whole test run: `node --import` this file.
import { register } from "node:module";

register("./tsx-loader.mjs", import.meta.url);
