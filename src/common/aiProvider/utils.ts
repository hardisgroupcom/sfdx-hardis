import { getEnvVar } from "../../config";

export class UtilsAi {
  public static isOpenApiAvailable() {
    if (getEnvVar("OPENAI_API_KEY")) {
      return true;
    }
    return false;
  }
}
