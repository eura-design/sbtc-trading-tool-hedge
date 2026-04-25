import { useState, useCallback, useEffect } from "react";
import { api } from "../api/client";
import { useDrawableStore } from "./useDrawableStore";

export function useTrendLines() {

  // ── 트렌드 라인 ───────────────────────────────────────────────────────────
  const lineStore = useDrawableStore("trendLines");
  const [lineMode,       setLineMode]       = useState(false);
  const [lineStart,      setLineStart]      = useState(null);
  const [linePreview,    setLinePreview]    = useState(null);
  const [selectedLineId, setSelectedLineId] = useState(null);

  // 구버전 서버 저장 데이터 1회 마이그레이션
  useEffect(() => {
    if (lineStore.items.length > 0) return;
    api("GET", "/api/trendlines")
      .then(data => {
        if (Array.isArray(data) && data.length > 0) lineStore.replaceAll(data);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelDraw = useCallback(() => {
    setLineMode(false); setLineStart(null); setLinePreview(null);
  }, []);

  const addLine = useCallback((t1, p1, t2, p2) => {
    lineStore.add({ t1, p1, t2, p2 });
    setLineMode(false); setLineStart(null); setLinePreview(null);
  }, [lineStore]);

  const deleteLine = useCallback((id) => {
    lineStore.remove(id); setSelectedLineId(null);
  }, [lineStore]);

  const updateLineEndpoint = useCallback((lineId, endpoint, t, p) => {
    lineStore.update(lineId, endpoint === "start" ? { t1: t, p1: p } : { t2: t, p2: p });
  }, [lineStore]);

  const setLinePosition = useCallback((lineId, t1, p1, t2, p2) => {
    lineStore.update(lineId, { t1, p1, t2, p2 });
  }, [lineStore]);

  // ── 원 ───────────────────────────────────────────────────────────────────
  const circleStore = useDrawableStore("trendCircles");
  const [circleMode,       setCircleMode]       = useState(false);
  const [circleCenter,     setCircleCenter]     = useState(null);
  const [circlePreview,    setCirclePreview]    = useState(null);
  const [selectedCircleId, setSelectedCircleId] = useState(null);

  const cancelCircleDraw = useCallback(() => {
    setCircleMode(false); setCircleCenter(null); setCirclePreview(null);
  }, []);

  const addCircle = useCallback((cx_t, cx_p, rx_t, rx_p) => {
    circleStore.add({ cx_t, cx_p, rx_t, rx_p });
    setCircleMode(false); setCircleCenter(null); setCirclePreview(null);
  }, [circleStore]);

  const deleteCircle = useCallback((id) => {
    circleStore.remove(id); setSelectedCircleId(null);
  }, [circleStore]);

  const moveCircle = useCallback((id, cx_t, cx_p, rx_t, rx_p) => {
    circleStore.update(id, { cx_t, cx_p, rx_t, rx_p });
  }, [circleStore]);

  // ── 채널 ─────────────────────────────────────────────────────────────────
  const channelStore = useDrawableStore("trendChannels");
  const [channelMode,       setChannelMode]       = useState(false);
  const [channelStep,       setChannelStep]       = useState(0);
  const [channelPoints,     setChannelPoints]     = useState(null);
  const [channelPreview,    setChannelPreview]    = useState(null);
  const [selectedChannelId, setSelectedChannelId] = useState(null);

  const cancelChannelDraw = useCallback(() => {
    setChannelMode(false); setChannelStep(0); setChannelPoints(null); setChannelPreview(null);
  }, []);

  const addChannel = useCallback((t1, p1, t2, p2, offset, isLog = false) => {
    channelStore.add({ t1, p1, t2, p2, offset, isLog });
    setChannelMode(false); setChannelStep(0); setChannelPoints(null); setChannelPreview(null);
  }, [channelStore]);

  const deleteChannel = useCallback((id) => {
    channelStore.remove(id); setSelectedChannelId(null);
  }, [channelStore]);

  const updateChannelEndpoint = useCallback((channelId, endpoint, t, p) => {
    channelStore.update(channelId, endpoint === "start" ? { t1: t, p1: p } : { t2: t, p2: p });
  }, [channelStore]);

  const setChannelPosition = useCallback((channelId, t1, p1, t2, p2) => {
    channelStore.update(channelId, { t1, p1, t2, p2 });
  }, [channelStore]);

  const setChannelOffset = useCallback((channelId, offset) => {
    channelStore.update(channelId, { offset });
  }, [channelStore]);

  return {
    // 트렌드 라인
    lines: lineStore.items,
    lineMode,       setLineMode,
    lineStart,      setLineStart,
    linePreview,    setLinePreview,
    selectedLineId, setSelectedLineId,
    cancelDraw, addLine, deleteLine, updateLineEndpoint, setLinePosition,
    setLineOpacity:  lineStore.setOpacity,
    toggleLineLock:  lineStore.toggleLock,
    toggleLineAlert: lineStore.toggleAlert,
    setLineAlertOff: lineStore.setAlertOff,
    // 원
    circles: circleStore.items,
    circleMode,       setCircleMode,
    circleCenter,     setCircleCenter,
    circlePreview,    setCirclePreview,
    selectedCircleId, setSelectedCircleId,
    cancelCircleDraw, addCircle, deleteCircle, moveCircle,
    setCircleOpacity:  circleStore.setOpacity,
    toggleCircleLock:  circleStore.toggleLock,
    toggleCircleAlert: circleStore.toggleAlert,
    setCircleAlertOff: circleStore.setAlertOff,
    // 채널
    channels: channelStore.items,
    channelMode,       setChannelMode,
    channelStep,       setChannelStep,
    channelPoints,     setChannelPoints,
    channelPreview,    setChannelPreview,
    selectedChannelId, setSelectedChannelId,
    cancelChannelDraw, addChannel, deleteChannel,
    updateChannelEndpoint, setChannelPosition, setChannelOffset,
    setChannelOpacity:  channelStore.setOpacity,
    toggleChannelLock:  channelStore.toggleLock,
    toggleChannelAlert: channelStore.toggleAlert,
    setChannelAlertOff: channelStore.setAlertOff,
  };
}
