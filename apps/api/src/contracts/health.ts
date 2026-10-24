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