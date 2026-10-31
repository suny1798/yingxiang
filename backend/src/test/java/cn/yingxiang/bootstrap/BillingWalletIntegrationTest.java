package cn.yingxiang.bootstrap;

import cn.yingxiang.mapper.BillingMapper;
import cn.yingxiang.manager.ConnectionProbe;
import cn.yingxiang.manager.SchemaOperations;
import cn.yingxiang.service.BillingService;
import cn.yingxiang.exception.BusinessFailure;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

/** 显式启用，只使用随机隔离schema和合成用户；不启动API、供应商或支付。 */
@EnabledIfSystemProperty(named="yingxiang.billing.it",matches="true")
class BillingWalletIntegrationTest {
    private static final String SCHEMA="yingxiang_migration_it_"+UUID.randomUUID().toString().replace("-","").substring(0,12);
    private static JdbcTemplate jdbc;
    private static TransactionTemplate tx;
    private static BillingService billing;
    private static SqlSessionTemplate session;
    @BeforeAll static void setup() throws Exception {
        ((ch.qos.logback.classic.Logger)org.slf4j.LoggerFactory.getLogger("org.flywaydb")).setLevel(ch.qos.logback.classic.Level.ERROR);
        var config=ConnectionProbe.load(Path.of("config/application-local.yml"));
        config.setProperty("migration.db-schema",SCHEMA);
        SchemaOperations.flyway(config).migrate();
        var source=SchemaOperations.dataSource(config,false);
        jdbc=new JdbcTemplate(source);tx=new TransactionTemplate(new DataSourceTransactionManager(source));
        var factory=new SqlSessionFactoryBean();factory.setDataSource(source);
        var mybatis=new org.apache.ibatis.session.Configuration();mybatis.addMapper(BillingMapper.class);mybatis.addMapper(cn.yingxiang.mapper.PaymentMapper.class);factory.setConfiguration(mybatis);
        session=new SqlSessionTemplate(factory.getObject());var mapper=session.getMapper(BillingMapper.class);
        billing=new BillingService(mapper,new MockEnvironment().withProperty("migration.db-schema",SCHEMA));
        for(String id:java.util.List.of("one","two","race","pay")) jdbc.update("INSERT INTO users(id,username,salt,password_hash,created_at) VALUES(?,?, 'synthetic','synthetic',1)",id,id);
    }
    @AfterAll static void cleanup() {
        if(jdbc!=null&&SCHEMA.matches("yingxiang_migration_it_[a-f0-9]{12}")) jdbc.execute("DROP SCHEMA \""+SCHEMA+"\" CASCADE");
    }
    private static void atomic(Runnable action){tx.executeWithoutResult(status->action.run());}
    @Test void onlyPaidOrdersFundWalletAndRepeatedEventsNeverFundTwice() {
        jdbc.execute("COMMENT ON SCHEMA \""+SCHEMA+"\" IS 'yingxiang-m10b-integration:"+SCHEMA+"'");
        var env=new MockEnvironment().withProperty("migration.db-schema",SCHEMA).withProperty("migration.stripe-api-base","http://127.0.0.1:1");
        var payments=session.getMapper(cn.yingxiang.mapper.PaymentMapper.class);
        var service=new cn.yingxiang.service.impl.PaymentsServiceImpl(jdbc,payments,
                org.mockito.Mockito.mock(cn.yingxiang.mapper.MigrationAccounts.class),org.mockito.Mockito.mock(cn.yingxiang.service.RateLimitService.class),
                tx.getTransactionManager(),env,new tools.jackson.databind.json.JsonMapper(),billing);
        String id=UUID.randomUUID().toString(),sku="credits-v2-creator";
        atomic(()->payments.insertOrder('"'+SCHEMA+'"'+".",id,"pay",UUID.randomUUID().toString(),sku,null,null,1900,"creator",400,"usd","creating",1,"{}","credits-v2"));
        var value=new java.util.HashMap<String,Object>();
        value.put("id","cs_synthetic_wallet");value.put("mode","payment");value.put("livemode",false);
        value.put("client_reference_id",id);value.put("currency","usd");value.put("amount_total",1900);
        value.put("metadata",java.util.Map.of("orderId",id,"userId","pay","sku",sku));
        value.put("status","open");value.put("payment_status","unpaid");
        service.apply(value,"evt_pending_wallet",false);
        assertThat(billing.view("pay","stripe_sandbox").get("availableCredits")).isEqualTo(0L);
        value.put("status","complete");value.put("payment_status","paid");
        service.apply(value,"evt_paid_wallet",false);service.apply(value,"evt_paid_wallet",false);
        service.apply(value,"evt_paid_wallet_again",false);
        assertThat(billing.view("pay","stripe_sandbox").get("availableCredits")).isEqualTo(400L);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_credit_entries WHERE user_id='pay' AND kind='topup'",Integer.class)).isEqualTo(1);
        value.put("amount_total",1901);
        assertThatThrownBy(()->service.apply(value,"evt_wrong_wallet",false)).isInstanceOf(BusinessFailure.class);
        assertThat(billing.view("pay","stripe_sandbox").get("availableCredits")).isEqualTo(400L);
    }
    @Test void topupUsageRefundIdempotencyAndEnvironmentIsolation() {
        atomic(()->billing.fundSandbox("one","order-one","credits-v2-light",500,"usd"));
        atomic(()->billing.fundSandbox("one","order-one","credits-v2-light",500,"usd"));
        assertThat(billing.view("one","stripe_sandbox").get("availableCredits")).isEqualTo(100L);
        assertThat(billing.view("one","real_usage").get("availableCredits")).isEqualTo(0L);
        assertThatThrownBy(()->atomic(()->billing.reserve("one","real_usage","real-denied","studio",15000))).isInstanceOf(BusinessFailure.class);
        atomic(()->billing.reserve("one","stripe_sandbox","session-one","studio",15000));
        atomic(()->billing.reserve("one","stripe_sandbox","session-one","studio",15000));
        atomic(()->billing.settleVerified("session-one",7700));
        atomic(()->billing.settleVerified("session-one",7700));
        var view=billing.view("one","stripe_sandbox");
        assertThat(view.get("availableCredits")).isEqualTo(92L);
        assertThat(view.get("reservedCredits")).isEqualTo(0L);
        assertThat(view.get("spentCredits")).isEqualTo(8L);
        assertThatThrownBy(()->atomic(()->billing.settleVerified("session-one",0))).isInstanceOf(BusinessFailure.class);
        atomic(()->billing.reserve("one","stripe_sandbox","session-two","prompt",15000));
        atomic(()->billing.settleVerified("session-two",0));
        assertThat(billing.view("one","stripe_sandbox").get("availableCredits")).isEqualTo(92L);
        atomic(()->billing.reserve("one","stripe_sandbox","video-one","video",7700));
        atomic(()->billing.settleVideoVerified("video-one","failed"));
        assertThat(billing.view("one","stripe_sandbox").get("availableCredits")).isEqualTo(92L);
        atomic(()->billing.reserve("one","stripe_sandbox","video-two","video",7700));
        atomic(()->billing.review("video-two"));
        assertThat(billing.view("one","stripe_sandbox").get("reservedCredits")).isEqualTo(8L);
        atomic(()->billing.settleVideoVerified("video-two","completed"));
        assertThat(billing.view("one","stripe_sandbox").get("spentCredits")).isEqualTo(8L);
        jdbc.update("INSERT INTO video_jobs(id,user_id,state,created_at,expires_at,seconds_milli,micro_usd,result_duration_ms) VALUES('video-two','one','completed',1,9999999999999,7700,320000,4934)");
        atomic(()->billing.settleVideoVerified("video-two","completed"));
        atomic(()->billing.settleVideoVerified("video-two","completed"));
        assertThat(billing.view("one","stripe_sandbox").get("spentCredits")).isEqualTo(13L);
        assertThat(billing.view("one","stripe_sandbox").get("availableCredits")).isEqualTo(87L);
        atomic(()->billing.fundSandbox("two","order-two","credits-v2-creator",1900,"usd"));
        assertThat(billing.view("two","stripe_sandbox").get("availableCredits")).isEqualTo(400L);
        assertThatThrownBy(()->atomic(()->billing.reserve("two","stripe_sandbox","session-one","studio",15000))).isInstanceOf(BusinessFailure.class);
    }
    @Test void competingReservationsCannotOverdrawLastBalance() throws Exception {
        atomic(()->billing.fundSandbox("race","order-race","credits-v2-light",500,"usd"));
        for(int i=0;i<2;i++){String id="prior-"+i;atomic(()->billing.reserve("race","stripe_sandbox",id,"studio",30000));atomic(()->billing.settleVerified(id,30000));}
        atomic(()->billing.reserve("race","stripe_sandbox","prior-short","studio",15000));
        atomic(()->billing.settleVerified("prior-short",10000));
        try(var pool=Executors.newFixedThreadPool(2)){
            var gate=new CountDownLatch(1);
            Callable<Boolean> attempt=()->{gate.await();try{atomic(()->billing.reserve("race","stripe_sandbox",UUID.randomUUID().toString(),"studio",30000));return true;}catch(BusinessFailure insufficient){return false;}};
            var a=pool.submit(attempt);var b=pool.submit(attempt);gate.countDown();
            assertThat(java.util.List.of(a.get(20,TimeUnit.SECONDS),b.get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder(true,false);
        }
        assertThat(billing.view("race","stripe_sandbox").get("availableCredits")).isEqualTo(0L);
        assertThat(billing.view("race","stripe_sandbox").get("reservedCredits")).isEqualTo(30L);
    }
}
