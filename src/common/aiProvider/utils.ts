import { getEnvVar } from "../../config/index.js";

export class UtilsAi {
  public static isOpenApiAvailable() {
    if (getEnvVar("OPENAI_API_KEY")) {
      return true;
    }
    return false;
  }
}
