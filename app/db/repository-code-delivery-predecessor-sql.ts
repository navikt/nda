export const repositoryCodeDeliveryPredecessorSql = `
  SELECT delivery.head_sha
  FROM repository_code_deliveries delivery
  LEFT JOIN LATERAL (
    SELECT deployment.created_at, deployment.id
    FROM deployments deployment
    WHERE deployment.repository_code_delivery_id = delivery.id
    ORDER BY deployment.created_at, deployment.id
    LIMIT 1
  ) first_deployment ON true
  WHERE delivery.repository_id = d.repository_id
    AND (COALESCE(first_deployment.created_at, delivery.created_at), COALESCE(first_deployment.id, 0))
      < (d.created_at, d.id)
  ORDER BY COALESCE(first_deployment.created_at, delivery.created_at) DESC,
           COALESCE(first_deployment.id, 0) DESC, delivery.id DESC
  LIMIT 1
`
