/** 对外契约：健康检查响应（本目录下的文件都不许出现全文型字段名） */
export interface HealthResponse {
  status: 'ok';
  service: string;
  /** R-C 运行期护栏计数 —— check-dev 用它证明钩子真的跑了 */
  rc: {
    scanned: number;
    blocked: number;
  };
}

/** 就绪检查：库可达才算 ok —— 部署脚本与容器 healthcheck 用它 */
export interface ReadyResponse {
  status: 'ok' | 'unavailable';
}