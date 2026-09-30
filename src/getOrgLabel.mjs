/*
 *
 * Helper: `getOrgLabel`.
 *
 */
const getOrgLabel = () => {
  const { CLIENT_ID, BRANCH_NAME } = process.env;

  return `${CLIENT_ID || ""}${BRANCH_NAME ? ` (${BRANCH_NAME})` : ""}`.trim();
};

export default getOrgLabel;
