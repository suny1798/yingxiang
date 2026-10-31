package cn.yingxiang.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;

/** 沙盒订单、权益与支付事件固定 SQL；动态查单仍保留在 PaymentsServiceImpl。 */
@Mapper
public interface PaymentMapper {

    @Select("SELECT * FROM ${schema}orders WHERE user_id=#{userId} ORDER BY created_at DESC,id DESC LIMIT 50")
    List<Map<String, Object>> orders(@Param("schema") String schema, @Param("userId") String userId);

    @Select("SELECT seconds,total,reserved,used,revoked FROM ${schema}entitlement_grants "
            + "WHERE user_id=#{userId} AND environment='stripe_sandbox'")
    List<Map<String, Object>> sandboxGrants(@Param("schema") String schema, @Param("userId") String userId);

    @Select("SELECT * FROM ${schema}sandbox_credit_packs WHERE user_id=#{userId} ORDER BY created_at,order_id")
    List<Map<String, Object>> packs(@Param("schema") String schema, @Param("userId") String userId);

    @Insert("INSERT INTO ${schema}orders(id,user_id,request_id,sku,seconds,count,amount,plan_id,credits,"
            + "currency,state,created_at,request_snapshot,template_version) VALUES (#{id},#{userId},#{requestId},#{sku},#{seconds},"
            + "#{count},#{amount},#{planId},#{credits},#{currency},#{state},#{createdAt},#{snapshot},#{templateVersion})")
    int insertOrder(@Param("schema") String schema, @Param("id") String id, @Param("userId") String userId,
                    @Param("requestId") String requestId, @Param("sku") String sku, @Param("seconds") Integer seconds,
                    @Param("count") Integer count, @Param("amount") int amount, @Param("planId") String planId,
                    @Param("credits") Integer credits, @Param("currency") String currency, @Param("state") String state,
                    @Param("createdAt") long createdAt, @Param("snapshot") String snapshot, @Param("templateVersion") String templateVersion);

    @Select("SELECT id FROM ${schema}payment_events WHERE id=#{eventId}")
    List<String> eventIds(@Param("schema") String schema, @Param("eventId") String eventId);

    @Insert("INSERT INTO ${schema}sandbox_credit_packs(order_id,user_id,plan_id,credits,scenes,created_at) "
            + "VALUES (#{orderId},#{userId},#{planId},#{credits},#{scenes},#{now})")
    int insertPack(@Param("schema") String schema, @Param("orderId") String orderId, @Param("userId") String userId,
                   @Param("planId") String planId, @Param("credits") int credits, @Param("scenes") String scenes,
                   @Param("now") long now);

    @Update("UPDATE ${schema}orders SET session_id=#{sessionId},expires_at=#{expiresAt},"
            + "checkout_url=CASE WHEN #{hasUrl} THEN #{checkoutUrl} ELSE checkout_url END,state=#{state},"
            + "fulfilled_at=#{fulfilledAt} WHERE id=#{orderId}")
    int updateSession(@Param("schema") String schema, @Param("orderId") String orderId,
                      @Param("sessionId") String sessionId, @Param("expiresAt") Long expiresAt,
                      @Param("hasUrl") boolean hasUrl, @Param("checkoutUrl") String checkoutUrl,
                      @Param("state") String state, @Param("fulfilledAt") Long fulfilledAt);

    @Insert("INSERT INTO ${schema}payment_events(id,order_id,source,created_at) "
            + "VALUES (#{eventId},#{orderId},'stripe_sandbox',#{now})")
    int insertEvent(@Param("schema") String schema, @Param("eventId") String eventId,
                    @Param("orderId") String orderId, @Param("now") long now);

    @Select("SELECT id FROM ${schema}orders WHERE id<>#{orderId} AND session_id=#{sessionId}")
    List<String> otherSession(@Param("schema") String schema, @Param("orderId") String orderId,
                              @Param("sessionId") String sessionId);
}
