/*
 *
 * Sleep: Function to pause the execution for a specified duration.
 *
 * @param {number} ms - The duration to pause in milliseconds.
 * @returns {Promise<void>} A promise that resolves after the specified duration.
 *
 */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export default sleep;
