import { useState, useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext";
import { isLongToSide } from "../../utils/side";

export function ScaleInCard({ posData, side, lastPrice, onScaleIn, scaleInOrders, onCancelScaleIn, embedded }) {
  const { theme } = useTheme();
  const [orderType, setOrderType] = useState("LIMIT");
  const [price, setPrice] = useState(() => String(Math.round(lastPrice || posData?.entryPrice || 0)));
  const [pct,   setPct]   = useState(() => Number(localStorage.getItem("scaleInPct")) || 50);

  const isLong         = side === "LONG";
  const userEditedRef  = useRef(false);
  const lastPriceRef   = useRef(lastPrice);
  const resumeTimerRef = useRef(null);
  lastPriceRef.current = lastPrice;

  useEffect(() => {
    if (orderType !== "LIMIT") return;
    userEditedRef.current = false;
    clearTimeout(resumeTimerRef.current);
    const calc = () => {
      if (!userEditedRef.current && lastPriceRef.current) {
        setPrice(String(Math.round(lastPriceRef.current * (isLong ? 0.97 : 1.03))));
      }
    };
    calc();
    const id = setInterval(calc, 5000);
    return () => { clearInterval(id); clearTimeout(resumeTimerRef.current); };
  }, [orderType, isLong]);

  if (!posData) return null;

  const color    = isLong ? "#0ecb81" : "#f6465d";
  const addQty   = parseFloat((posData.size * pct / 100).toFixed(3));
  const refPrice = orderType === "MARKET" ? (lastPrice || 0) : (parseFloat(price) || 0);
  const avgPrice = refPrice > 0
    ? (posData.size * posData.entryPrice + addQty * refPrice) / (posData.size + addQty)
    : null;
  const priceNum    = parseFloat(price);
  const directionOk = orderType === "MARKET" || (
    isLong ? priceNum < (lastPrice || Infinity) : priceNum > (lastPrice || 0)
  );
  const valid = orderType === "MARKET"
    ? addQty >= 0.001
    : priceNum > 0 && addQty >= 0.001 && directionOk;

  const btnStyle = (active) => ({
    flex:1, padding:"4px 0", borderRadius:"3px", cursor:"pointer",
    fontFamily:"inherit", fontSize:"11px", fontWeight:"600",
    border:"none",
    background: active ? `${color}33` : "transparent",
    color: active ? color : theme.textFaint,
    transition:"background 0.15s",
  });

  const content = (
    <>
      {scaleInOrders?.map(o => (
        <div key={o.orderId} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"5px 8px", marginBottom:"4px", borderRadius:"4px",
          background:"#60a5fa18", border:"1px solid #60a5fa44" }}>
          <span style={{ fontSize:"11px", color:"#60a5fa" }}>
            대기중 ${o.price?.toLocaleString()} · {o.qty} BTC
          </span>
          <button onClick={() => onCancelScaleIn(o.orderId)} style={{
            background:"none", border:"none", color:"#f6465d",
            cursor:"pointer", fontSize:"12px", fontWeight:"700", padding:"0 2px",
          }}>✕</button>
        </div>
      ))}

      <div style={{ display:"flex", gap:"4px", marginBottom:"8px",
        background:theme.bgCard, borderRadius:"4px", padding:"2px" }}>
        <button style={btnStyle(orderType === "LIMIT")}  onClick={() => setOrderType("LIMIT")}>LIMIT</button>
        <button style={btnStyle(orderType === "MARKET")} onClick={() => setOrderType("MARKET")}>MARKET</button>
      </div>

      {orderType === "LIMIT" && (
        <>
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginBottom: priceNum > 0 && !directionOk ? "4px" : "8px" }}>
            <span style={{ fontSize:"11px", color:theme.textMuted, flexShrink:0 }}>가격</span>
            <input
              type="number" value={price}
              onChange={e => {
                userEditedRef.current = true;
                setPrice(e.target.value);
                clearTimeout(resumeTimerRef.current);
                resumeTimerRef.current = setTimeout(() => { userEditedRef.current = false; }, 60000);
              }}
              style={{
                flex:1, padding:"4px 6px", borderRadius:"4px",
                background:theme.bgCard,
                border:`1px solid ${priceNum > 0 && !directionOk ? "#f6465d" : theme.borderSec}`,
                color:theme.textPrimary, fontSize:"12px", fontFamily:"inherit", outline:"none",
              }}
            />
          </div>
          {priceNum > 0 && !directionOk && (
            <div style={{ fontSize:"10px", color:"#f6465d", marginBottom:"8px" }}>
              {isLong ? "▲ LONG 추가 진입은 현재가보다 낮아야 합니다" : "▼ SHORT 추가 진입은 현재가보다 높아야 합니다"}
            </div>
          )}
        </>
      )}

      <div style={{ marginBottom:"6px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"4px" }}>
          <span style={{ fontSize:"11px", color:theme.textMuted }}>추가 수량</span>
          <span style={{ fontSize:"12px", color, fontWeight:"600" }}>
            {pct}% ({addQty} BTC)
          </span>
        </div>
        <input
          type="range" min={0} max={100} step={5} value={pct}
          onChange={e => {
            const v = Math.max(5, Number(e.target.value));
            setPct(v);
            localStorage.setItem("scaleInPct", v);
          }}
          style={{ width:"100%", accentColor:color, cursor:"pointer", height:"3px" }}
        />
        <div style={{ display:"flex", justifyContent:"space-between",
          fontSize:"11px", color:theme.textBare, marginTop:"2px" }}>
          <span>0%</span><span>100%</span>
        </div>
      </div>

      {avgPrice && (
        <div style={{ display:"flex", justifyContent:"space-between",
          padding:"3px 0", marginBottom:"6px", borderBottom:`1px solid ${theme.border}` }}>
          <span style={{ fontSize:"11px", color:theme.textMuted }}>예상 평균가</span>
          <span style={{ fontSize:"12px", color:"#f0b90b", fontWeight:"600" }}>
            ${avgPrice.toLocaleString(undefined, { maximumFractionDigits:1 })}
          </span>
        </div>
      )}

      <button
        disabled={!valid}
        onClick={() => onScaleIn(isLongToSide(isLong), orderType, parseFloat(price) || null, addQty)}
        style={{
          width:"100%", padding:"8px 0", borderRadius:"5px",
          cursor: valid ? "pointer" : "not-allowed",
          background:"transparent",
          border:`1px solid ${valid ? color : theme.borderSec}`,
          color: valid ? color : theme.textFaint,
          fontSize:"13px", fontFamily:"inherit", fontWeight:"700",
          transition:"background 0.15s",
        }}
        onMouseEnter={e => { if (valid) e.currentTarget.style.background=`${color}22`; }}
        onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}
      >
        {orderType === "MARKET"
          ? (isLong ? "▲ 시장가 추가 매수" : "▼ 시장가 추가 매도")
          : (isLong ? "▲ 지정가 추가 매수" : "▼ 지정가 추가 매도")}
      </button>
    </>
  );

  if (embedded) return content;

  return (
    <div style={{ padding:"10px", border:`1px solid ${theme.borderSec}`,
      borderRadius:"5px", marginBottom:"10px" }}>
      <div style={{ fontSize:"12px", color:theme.textMuted, fontWeight:"600",
        letterSpacing:"0.05em", marginBottom:"8px" }}>
        추가 진입
      </div>
      {content}
    </div>
  );
}
