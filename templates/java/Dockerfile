# Java backend (Maven) build template.
# Multi-stage: build the JAR with Maven, then run it on a slim JRE.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# Leverage layer caching for dependencies.
COPY pom.xml ./
RUN mvn -q -DskipTests dependency:go-offline || true
COPY . .
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
ENV JAVA_OPTS=""
# Copy the built artifact. JAR_FILE can be overridden via build args.
ARG JAR_FILE=target/*.jar
COPY --from=build /app/${JAR_FILE} app.jar
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
