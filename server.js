const BCTC_DB = {
  "FPT": { revenue: 15200, revenue_prev: 12450, net_profit: 1610, profit_prev: 1320, profit_margin: 10.6, roe: 23.5, debt_ratio: 0.42, ocf: -200, pe: 20.1, pb: 4.8 },
  "HPG": { revenue: 34000, revenue_prev: 31340, net_profit: 3200, profit_prev: 2950, profit_margin: 9.4, roe: 18.2, debt_ratio: 0.65, ocf: 5000, pe: 12.5, pb: 1.6 },
  "VNM": { revenue: 14500, revenue_prev: 14200, net_profit: 2100, profit_prev: 2200, profit_margin: 14.5, roe: 25.1, debt_ratio: 0.31, ocf: 2800, pe: 16.8, pb: 4.2 },
  "VCB": { revenue: 18500, revenue_prev: 16480, net_profit: 7500, profit_prev: 6800, profit_margin: 40.5, roe: 21.3, debt_ratio: 0.15, ocf: 9000, pe: 14.2, pb: 2.9 },
  "VIC": { revenue: 42800, revenue_prev: 31650, net_profit: 2100, profit_prev: 1850, profit_margin: 4.9, roe: 4.2, debt_ratio: 0.95, ocf: -3500, pe: 45.2, pb: 1.8 },
  "DBC": { revenue: 3200, revenue_prev: 3375, net_profit: 150, profit_prev: 180, profit_margin: 4.7, roe: 12.5, debt_ratio: 0.88, ocf: -50, pe: 15.2, pb: 1.1 },
  "HAG": { revenue: 1200, revenue_prev: 1371, net_profit: -80, profit_prev: -50, profit_margin: -6.7, roe: -5.2, debt_ratio: 2.15, ocf: -200, pe: 0, pb: 0.8 },
  "TCB": { revenue: 12800, revenue_prev: 11500, net_profit: 5200, profit_prev: 4800, profit_margin: 40.6, roe: 19.8, debt_ratio: 0.18, ocf: 6100, pe: 6.5, pb: 1.2 },
  "MBB": { revenue: 11200, revenue_prev: 9800, net_profit: 4800, profit_prev: 4200, profit_margin: 42.9, roe: 22.1, debt_ratio: 0.22, ocf: 5500, pe: 5.8, pb: 1.3 }
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

      const analysis = runRuleBasedAnalysis(ticker, raw);
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

function formatNumber(num) {
  return num.toLocaleString('vi-VN');
}

function runRuleBasedAnalysis(ticker, d) {
  let score = 50;
  const flags = [];
  const summary = {};

  // TÍNH % TĂNG TRƯỞNG
  const rev_growth = d.revenue_prev > 0? ((d.revenue - d.revenue_prev) / d.revenue_prev * 100) : 0;
  const profit_growth = d.profit_prev!== 0? ((d.net_profit - d.profit_prev) / Math.abs(d.profit_prev) * 100) : 0;

  // 1. TĂNG TRƯỞNG - 30 điểm
  if (rev_growth > 15) {
    score += 15;
    summary.revenue = `Tăng ${rev_growth.toFixed(1)}% lên ${formatNumber(d.revenue)} tỷ`;
  } else if (rev_growth > 0) {
    score += 8;
    summary.revenue = `Tăng ${rev_growth.toFixed(1)}% lên ${formatNumber(d.revenue)} tỷ`;
  } else {
    score -= 10;
    summary.revenue = `Giảm ${Math.abs(rev_growth).toFixed(1)}% còn ${formatNumber(d.revenue)} tỷ`;
    flags.push('Doanh thu suy giảm');
  }

  if (d.net_profit > 0) {
    score += 10;
    const sign = profit_growth >= 0? '+' : '';
    summary.profit = `Lãi ${formatNumber(d.net_profit)} tỷ (${sign}${profit_growth.toFixed(1)}%)`;
  } else {
    score -= 20;
    summary.profit = `Lỗ ${formatNumber(Math.abs(d.net_profit))} tỷ`;
    flags.push('Lỗ sau thuế');
  }

  // 2. HIỆU QUẢ - 25 điểm
  if (d.profit_margin > 15) { score += 10; }
  else if (d.profit_margin > 5) { score += 5; }
  else { score -= 5; flags.push(`Biên lợi nhuận mỏng chỉ ${d.profit_margin.toFixed(1)}%`); }

  if (d.roe > 20) {
    score += 10;
    summary.roe = `Rất hiệu quả ${d.roe.toFixed(1)}%`;
  } else if (d.roe > 10) {
    score += 5;
    summary.roe = `Hiệu quả ${d.roe.toFixed(1)}%`;
  } else if (d.roe > 0) {
    summary.roe = `Kém hiệu quả ${d.roe.toFixed(1)}%`;
  } else {
    score -= 10;
    summary.roe = `Âm ${d.roe.toFixed(1)}%`;
    flags.push('ROE âm');
  }

  // 3. RỦI RO - 25 điểm
  if (d.debt_ratio > 1.0) {
    score -= 15;
    summary.debt = `Rất cao ${d.debt_ratio.toFixed(2)} lần`;
    flags.push(`Nợ vay rất cao gấp ${d.debt_ratio.toFixed(1)} lần VCSH`);
  } else if (d.debt_ratio > 0.6) {
    score -= 8;
    summary.debt = `Cao ${d.debt_ratio.toFixed(2)} lần`;
    flags.push('Áp lực nợ cao');
  } else {
    summary.debt = `An toàn ${d.debt_ratio.toFixed(2)} lần`;
  }

  if (d.ocf < 0 && d.net_profit > 0) {
    score -= 15;
    summary.cashflow = `Yếu, âm ${formatNumber(Math.abs(d.ocf))} tỷ`;
    flags.push(`Lợi nhuận ảo - dòng tiền HĐKD âm ${formatNumber(Math.abs(d.ocf))} tỷ`);
  } else if (d.ocf < 0) {
    score -= 10;
    summary.cashflow = `Âm ${formatNumber(Math.abs(d.ocf))} tỷ`;
    flags.push('Dòng tiền âm');
  } else {
    summary.cashflow = `Khỏe ${formatNumber(d.ocf)} tỷ`;
  }

  // 4. ĐỊNH GIÁ - 20 điểm
  if (d.pe > 30 && d.pe!== 0) {
    score -= 10;
    summary.valuation = `Đắt P/E ${d.pe.toFixed(1)}`;
    flags.push(`P/E cao ${d.pe.toFixed(1)}, định giá đắt`);
  } else if (d.pe < 10 && d.pe > 0) {
    score += 5;
    summary.valuation = `Rẻ P/E ${d.pe.toFixed(1)}`;
  } else {
    summary.valuation = `Hợp lý P/E ${d.pe.toFixed(1)}`;
  }

  score = Math.max(0, Math.min(100, score));

  let verdict = '';
  if (score >= 80) verdict = 'Phù hợp theo dõi sát, nền tảng tốt';
  else if (score >= 60) verdict = 'Phù hợp theo dõi, cần chú ý rủi ro';
  else verdict = 'Nhiều rủi ro, nên đứng ngoài quan sát';

  return {
    ticker: ticker.toUpperCase(),
    quarter: 'Q2/2024',
    score,
    summary,
    flags,
    verdict,
    raw_data: {...d, revenue_growth: rev_growth, profit_growth }
  };
}

async function generateAIExplanation(analysis, apiKey) {
  const prompt = `Bạn là chuyên gia tài chính cho nhà đầu tư nhỏ lẻ. Dựa trên dữ liệu đã phân tích sẵn:

- Score: ${analysis.score}/100
- Tóm tắt:
    * Doanh thu: ${analysis.summary.revenue}
    * Lợi nhuận: ${analysis.summary.profit}
    * Nợ/VCSH: ${analysis.summary.debt}
    * Dòng tiền: ${analysis.summary.cashflow}
    * ROE: ${analysis.summary.roe}
    * Định giá: ${analysis.summary.valuation}
- Cảnh báo: ${analysis.flags.join(', ') || 'Không có'}

Viết 4 phần, giọng GenZ dễ hiểu, dùng emoji, KHÔNG dùng dấu --:

1. Nhận định chính: 1-2 câu về tình hình làm ăn, dùng SỐ LIỆU CỤ THỂ đã cho
2. Cảnh báo rủi ro: Nêu rõ rủi ro từ flags với SỐ LIỆU, nếu không có thì nói "Chưa thấy rủi ro lớn"
3. Kết luận chuyên gia: Dùng đúng câu "${analysis.verdict}"
4. Lưu ý: "Đây không phải khuyến nghị mua/bán"

QUAN TRỌNG: Không tự bịa số, không dự đoán giá, không nói nên mua hay bán. Dùng đúng số đã cho.`;

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
      max_tokens: 500,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`AI lỗi: ${data.error?.message}`);
  return data.choices[0].message.content;
}
