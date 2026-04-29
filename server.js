const BCTC_DB = {
  "FPT": { revenue: 15200, revenue_growth: 22.1, net_profit: 1610, profit_margin: 10.6, roe: 23.5, debt_ratio: 0.42, ocf: -200, pe: 20.1, pb: 4.8 },
  "HPG": { revenue: 34000, revenue_growth: 8.5, net_profit: 3200, profit_margin: 9.4, roe: 18.2, debt_ratio: 0.65, ocf: 5000, pe: 12.5, pb: 1.6 },
  "VNM": { revenue: 14500, revenue_growth: 2.1, net_profit: 2100, profit_margin: 14.5, roe: 25.1, debt_ratio: 0.31, ocf: 2800, pe: 16.8, pb: 4.2 },
  "VCB": { revenue: 18500, revenue_growth: 12.2, net_profit: 7500, profit_margin: 40.5, roe: 21.3, debt_ratio: 0.15, ocf: 9000, pe: 14.2, pb: 2.9 },
  "VIC": { revenue: 42800, revenue_growth: 35.2, net_profit: 2100, profit_margin: 4.9, roe: 4.2, debt_ratio: 0.95, ocf: -3500, pe: 45.2, pb: 1.8 },
  "DBC": { revenue: 3200, revenue_growth: -5.2, net_profit: 150, profit_margin: 4.7, roe: 12.5, debt_ratio: 0.88, ocf: -50, pe: 15.2, pb: 1.1 },
  "HAG": { revenue: 1200, revenue_growth: -12.5, net_profit: -80, profit_margin: -6.7, roe: -5.2, debt_ratio: 2.15, ocf: -200, pe: 0, pb: 0.8 }
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
      });
    }

    if (request.method!== 'POST') return new Response('Method Not Allowed', { status: 405 });

    try {
      const { ticker } = await request.json();
      if (!ticker) throw new Error('Thiếu mã CP');

      const raw = BCTC_DB[ticker.toUpperCase()];
      if (!raw) throw new Error(`Chưa có data ${ticker}. Hiện có: ${Object.keys(BCTC_DB).join(', ')}`);

      // BƯỚC 1: RULE-BASED - TÍNH TOÁN CỨNG
      const analysis = runRuleBasedAnalysis(ticker, raw);

      // BƯỚC 2: AI VIẾT LẠI THÀNH TIẾNG NGƯỜI
      const explanation = await generateAIExplanation(analysis, env.OPENROUTER_KEY);

      return new Response(JSON.stringify({
        ...analysis,
        explanation
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  },
};

// LOGIC CỨNG - KHÔNG DÙNG AI ĐỂ TÍNH
function runRuleBasedAnalysis(ticker, d) {
  let score = 50;
  const flags = [];
  const summary = {};

  // 1. TĂNG TRƯỞNG - 30 điểm
  if (d.revenue_growth > 15) { score += 15; summary.revenue = 'Tăng mạnh'; }
  else if (d.revenue_growth > 0) { score += 8; summary.revenue = 'Tăng nhẹ'; }
  else { score -= 10; summary.revenue = 'Giảm'; flags.push('Doanh thu suy giảm'); }

  if (d.net_profit > 0) { score += 10; summary.profit = 'Có lãi'; }
  else { score -= 20; summary.profit = 'Đang lỗ'; flags.push('Lỗ sau thuế'); }

  // 2. HIỆU QUẢ - 25 điểm
  if (d.profit_margin > 15) { score += 10; }
  else if (d.profit_margin > 5) { score += 5; }
  else { score -= 5; flags.push('Biên lợi nhuận mỏng'); }

  if (d.roe > 20) { score += 10; summary.roe = 'Rất hiệu quả'; }
  else if (d.roe > 10) { score += 5; summary.roe = 'Hiệu quả'; }
  else if (d.roe > 0) { summary.roe = 'Kém hiệu quả'; }
  else { score -= 10; summary.roe = 'Âm'; flags.push('ROE âm'); }

  // 3. RỦI RO - 25 điểm
  if (d.debt_ratio > 1.0) { score -= 15; summary.debt = 'Rất cao'; flags.push('Nợ vay rất cao'); }
  else if (d.debt_ratio > 0.6) { score -= 8; summary.debt = 'Cao'; flags.push('Áp lực nợ cao'); }
  else { summary.debt = 'An toàn'; }

  if (d.ocf < 0 && d.net_profit > 0) {
    score -= 15; summary.cashflow = 'Yếu'; flags.push('Lợi nhuận ảo - dòng tiền âm');
  } else if (d.ocf < 0) {
    score -= 10; summary.cashflow = 'Âm'; flags.push('Dòng tiền âm');
  } else {
    summary.cashflow = 'Khỏe';
  }

  // 4. ĐỊNH GIÁ - 20 điểm
  if (d.pe > 30 && d.pe !== 0) { score -= 10; summary.valuation = 'Đắt'; flags.push('P/E cao, định giá đắt'); }
  else if (d.pe < 10 && d.pe > 0) { score += 5; summary.valuation = 'Rẻ'; }
  else { summary.valuation = 'Hợp lý'; }

  score = Math.max(0, Math.min(100, score));

  // KẾT LUẬN THEO SCORE
  let verdict = '';
  if (score >= 80) verdict = 'Phù hợp theo dõi sát, nền tảng tốt';
  else if (score >= 60) verdict = 'Phù hợp theo dõi, cần chú ý rủi ro';
  else verdict = 'Nhiều rủi ro, nên đứng ngoài quan sát';

  return {
    ticker: ticker.toUpperCase(),
    score,
    summary,
    flags,
    verdict,
    raw_data: d
  };
}

// AI CHỈ ĐỂ VIẾT LẠI - KHÔNG TÍNH TOÁN
async function generateAIExplanation(analysis, apiKey) {
  const prompt = `Bạn là chuyên gia tài chính cho nhà đầu tư nhỏ lẻ. Dựa trên dữ liệu đã phân tích sẵn:

- Score: ${analysis.score}/100
- Tóm tắt: Doanh thu ${analysis.summary.revenue}, Lợi nhuận ${analysis.summary.profit}, Nợ ${analysis.summary.debt}, Dòng tiền ${analysis.summary.cashflow}, ROE ${analysis.summary.roe}, Định giá ${analysis.summary.valuation}
- Cảnh báo: ${analysis.flags.join(', ') || 'Không có'}

Viết 1 đoạn 4 phần, giọng GenZ dễ hiểu, dùng emoji, KHÔNG dùng dấu --:

1. Nhận định chính: 1-2 câu về tình hình làm ăn
2. Cảnh báo rủi ro: Nêu rõ rủi ro từ flags, nếu không có thì nói "Chưa thấy rủi ro lớn"
3. Kết luận chuyên gia: Dùng đúng câu này "${analysis.verdict}"
4. Lưu ý: "Đây không phải khuyến nghị mua/bán"

QUAN TRỌNG: Không tự bịa số, không dự đoán giá, không nói nên mua hay bán.`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://finsnap.app',
      'X-Title': 'FinSnap'
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`AI lỗi: ${data.error?.message}`);
  return data.choices[0].message.content;
}
