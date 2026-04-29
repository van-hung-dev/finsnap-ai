export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method!== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const { ticker } = await request.json();
      if (!ticker) throw new Error('Thiếu mã CP');

      // BƯỚC 1: LẤY DỮ LIỆU BCTC TỪ CAFEF
      const financialData = await getFinancialDataFromCafef(ticker);

      // BƯỚC 2: GỌI AI PHÂN TÍCH
      const aiPrompt = `Bạn là chuyên gia tài chính GenZ. Phân tích cổ phiếu ${ticker} dựa trên số liệu sau:
      - Doanh thu Q gần nhất: ${financialData.revenue} tỷ
      - Lợi nhuận sau thuế: ${financialData.net_profit} tỷ
      - Nợ/VCSH: ${financialData.debt_ratio}
      - ROE: ${financialData.roe}%
      - Dòng tiền HĐKD: ${financialData.ocf} tỷ

      Viết 3-4 câu, giọng văn GenZ, hài hước, dùng emoji. Kết luận: đáng đầu tư hay né.`;

      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openrouter/free',
          messages: [{ role: 'user', content: aiPrompt }],
          max_tokens: 300,
        }),
      });

      const aiData = await aiResponse.json();
      const explanation = aiData.choices[0].message.content;

      return new Response(JSON.stringify({
        explanation,
        raw_data: financialData // Trả về cho frontend hiển thị
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};

// HÀM LẤY DATA TỪ CAFEF
async function getFinancialDataFromCafef(ticker) {
  // Endpoint lấy BCTC của Cafef - Q gần nhất
  const url = `https://s.cafef.vn/Ajax/PageNew/DataHose.ashx?symbol=${ticker}&PageIndex=1&PageSize=1&Type=2`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://s.cafef.vn/'
    }
  });

  const html = await res.text();

  // Parse HTML lấy số - Cafef trả về bảng HTML
  // Regex này lấy Doanh thu, LNST từ bảng BCTC
  const revenueMatch = html.match(/Doanh thu thuần.*?>([\d,\.]+)</);
  const profitMatch = html.match(/Lợi nhuận sau thuế.*?>([\d,\.]+)</);
  const equityMatch = html.match(/Vốn chủ sở hữu.*?>([\d,\.]+)</);
  const debtMatch = html.match(/Nợ phải trả.*?>([\d,\.]+)</);
  const ocfMatch = html.match(/Lưu chuyển tiền.*?hoạt động.*?>([\d,\.\-]+)</);

  const revenue = revenueMatch? parseFloat(revenueMatch[1].replace(/,/g, '')) : 0;
  const net_profit = profitMatch? parseFloat(profitMatch[1].replace(/,/g, '')) : 0;
  const equity = equityMatch? parseFloat(equityMatch[1].replace(/,/g, '')) : 1;
  const debt = debtMatch? parseFloat(debtMatch[1].replace(/,/g, '')) : 0;
  const ocf = ocfMatch? parseFloat(ocfMatch[1].replace(/,/g, '')) : 0;

  if (!revenue ||!net_profit) {
    throw new Error(`Không lấy được BCTC của ${ticker} từ Cafef`);
  }

  return {
    ticker: ticker,
    quarter: 'Q gần nhất',
    revenue: revenue / 1e9, // Đổi sang tỷ
    net_profit: net_profit / 1e9,
    debt_ratio: debt / equity,
    ocf: ocf / 1e9,
    roe: (net_profit / equity * 100).toFixed(1),
    score: calculateScore({net_profit, ocf, debt_ratio: debt/equity})
  };
}

function calculateScore(data) {
  let score = 50;
  if (data.net_profit > 0) score += 20;
  if (data.ocf > 0) score += 15;
  if (data.debt_ratio < 1) score += 15;
  return Math.min(score, 100);
}
