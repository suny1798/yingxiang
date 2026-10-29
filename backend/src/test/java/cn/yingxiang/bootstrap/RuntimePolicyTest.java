package cn.yingxiang.bootstrap;
import java.net.URI;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.*;
class RuntimePolicyTest {
 @Test void preservesExplicitLocalhostOrigin() {
  var env=new MockEnvironment().withProperty("migration.public-origin","http://127.0.0.1:8787")
      .withProperty("migration.allowed-origins","http://127.0.0.1:8787,http://localhost:8787");
  var origins=new MigrationOrigin(env);
  assertThat(origins.hostAllowed("localhost:8787")).isTrue();
  assertThat(origins.originAllowed("http://localhost:8787")).isTrue();
  assertThat(origins.hostAllowed("evil.example:8787")).isFalse();
 }
 @Test void runtimePinsHttpsOriginPathAndPort() {
  RuntimePolicy.endpoint(URI.create("https://api.decart.ai/v1/client/tokens"),"api.decart.ai","/v1/client/tokens",true);
  for(String target: new String[]{"http://api.decart.ai/v1/client/tokens","https://api.decart.ai.evil/v1/client/tokens","https://api.decart.ai:8443/v1/client/tokens","https://api.decart.ai/v1/client/tokens?x=1","https://user@api.decart.ai/v1/client/tokens","https://127.0.0.1/v1/client/tokens"})
   assertThatThrownBy(()->RuntimePolicy.endpoint(URI.create(target),"api.decart.ai","/v1/client/tokens",true)).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void fixtureAndRuntimeCredentialsCannotMix() {
  RuntimePolicy.tokenKey("dct_synthetic_example_123",true);
  assertThatThrownBy(()->RuntimePolicy.tokenKey("synthetic-example-key",true)).isInstanceOf(IllegalArgumentException.class);
  assertThatThrownBy(()->RuntimePolicy.tokenKey("dct_synthetic_example_123",false)).isInstanceOf(IllegalArgumentException.class);
 }
 @Test void schemaModeIsExplicit() {
  var env=new MockEnvironment().withProperty("migration.runtime-enabled","true").withProperty("migration.db-schema","yingxiang_migration");
  assertThat(MigrationSupport.requireIsolatedSchema(null,env,"test")).isEqualTo("\"yingxiang_migration\".");
  env.setProperty("migration.db-schema","yingxiang_migration_it_0123456789ab");
  assertThatThrownBy(()->MigrationSupport.requireIsolatedSchema(null,env,"test")).isInstanceOf(IllegalStateException.class);
 }
 @Test void apiCannotRunWorkerLoop() {
  assertThatThrownBy(()->new RuntimeRole(new MockEnvironment().withProperty("migration.worker-enabled","true"))).isInstanceOf(IllegalStateException.class);
  new RuntimeRole(new MockEnvironment().withProperty("migration.role","worker").withProperty("migration.worker-enabled","true"));
  assertThatThrownBy(()->new RuntimeRole(new MockEnvironment().withProperty("migration.role","worker"))).isInstanceOf(IllegalStateException.class);
 }
 @Test void unreadableDatabaseReturnsControlledNotReady() {
  var source=org.mockito.Mockito.mock(javax.sql.DataSource.class);
  assertThat(new Readiness(source,new MockEnvironment()).check()).containsEntry("ready",false);
 }
}
