module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  res.writeHead(200);
  res.end(JSON.stringify({
    message: 'YouTube connect API',
    endpoint: '/api/connect/:connectId?channel=YOUTUBE_CHANNEL_ID',
    example: '/api/connect/ABC123?channel=UC1234567890',
  }));
};
