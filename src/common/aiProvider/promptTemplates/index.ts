import { PromptTemplateDefinition } from "./types.js";

import PROMPT_SOLVE_DEPLOYMENT_ERROR from "./PROMPT_SOLVE_DEPLOYMENT_ERROR.js";
import PROMPT_DESCRIBE_FLOW from "./PROMPT_DESCRIBE_FLOW.js";
import PROMPT_DESCRIBE_FLOW_DIFF from "./PROMPT_DESCRIBE_FLOW_DIFF.js";
import PROMPT_DESCRIBE_OBJECT from "./PROMPT_DESCRIBE_OBJECT.js";
import PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD from "./PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD.js";
import PROMPT_DESCRIBE_APEX from "./PROMPT_DESCRIBE_APEX.js";
import PROMPT_DESCRIBE_PAGE from "./PROMPT_DESCRIBE_PAGE.js";
import PROMPT_DESCRIBE_PROFILE from "./PROMPT_DESCRIBE_PROFILE.js";
import PROMPT_DESCRIBE_PERMISSION_SET from "./PROMPT_DESCRIBE_PERMISSION_SET.js";
import PROMPT_DESCRIBE_PERMISSION_SET_GROUP from "./PROMPT_DESCRIBE_PERMISSION_SET_GROUP.js";
import PROMPT_DESCRIBE_ASSIGNMENT_RULES from "./PROMPT_DESCRIBE_ASSIGNMENT_RULES.js";
import PROMPT_DESCRIBE_APPROVAL_PROCESS from "./PROMPT_DESCRIBE_APPROVAL_PROCESS.js";
import PROMPT_DESCRIBE_LWC from "./PROMPT_DESCRIBE_LWC.js";
import PROMPT_DESCRIBE_AUTORESPONSE_RULES from "./PROMPT_DESCRIBE_AUTORESPONSE_RULES.js";
import PROMPT_DESCRIBE_ESCALATION_RULES from "./PROMPT_DESCRIBE_ESCALATION_RULES.js";
import PROMPT_DESCRIBE_PACKAGE from "./PROMPT_DESCRIBE_PACKAGE.js";
import PROMPT_DESCRIBE_ROLES from "./PROMPT_DESCRIBE_ROLES.js";

export const PROMPT_TEMPLATES: Record<string, PromptTemplateDefinition> = {
  PROMPT_SOLVE_DEPLOYMENT_ERROR,
  PROMPT_DESCRIBE_FLOW,
  PROMPT_DESCRIBE_FLOW_DIFF,
  PROMPT_DESCRIBE_OBJECT,
  PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD,
  PROMPT_DESCRIBE_APEX,
  PROMPT_DESCRIBE_PAGE,
  PROMPT_DESCRIBE_PACKAGE,
  PROMPT_DESCRIBE_PROFILE,
  PROMPT_DESCRIBE_PERMISSION_SET,
  PROMPT_DESCRIBE_PERMISSION_SET_GROUP,
  PROMPT_DESCRIBE_ASSIGNMENT_RULES,
  PROMPT_DESCRIBE_APPROVAL_PROCESS,
  PROMPT_DESCRIBE_LWC,
  PROMPT_DESCRIBE_AUTORESPONSE_RULES,
  PROMPT_DESCRIBE_ESCALATION_RULES,
  PROMPT_DESCRIBE_ROLES,
};
