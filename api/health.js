/**
 * Example Vercel serverless function with correct error handling.
 * Prevents FUNCTION_INVOCATION_FAILED by always returning a response
 * and never letting the runtime throw an unhandled exception.
 *
 * If you don't need any API routes, you can delete the entire api/ folder.
 */

module.exports = function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).end(
      JSON.stringify({ ok: true, message: 'METRIX API is running' })
    );
  } catch (err) {
    // Never let the process throw — always send a response
    res.setHeader('Content-Type', 'application/json');
    res.status(500).end(
      JSON.stringify({ ok: false, error: 'Internal server error' })
    );
  }
};
